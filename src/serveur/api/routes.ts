import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Evenement } from '../../domaine/types';
import type { Depots } from '../base/depots';
import type { Diffuseur } from '../diffuseur';
import { ErreurMaquette, POLITIQUE_MAQUETTE, pageErreurMaquette, type LecteurMaquette } from '../maquette';
import { ErreurMetier } from '../erreurs';
import type { ServiceTickets } from '../service-tickets';

const saisieSchema = z.object({
  titre: z.string().trim().min(1, 'Le titre est obligatoire.').max(120, 'Le titre fait 120 caractères au plus.'),
  description: z.string().trim().max(5000).default(''),
  projetId: z.number().int().positive().nullable().default(null),
});

const idSchema = z.object({ id: z.coerce.number().int().positive() });
const commentaireParamsSchema = idSchema.extend({ commentaireId: z.coerce.number().int().positive() });
const scenarioParamsSchema = idSchema.extend({ ordre: z.coerce.number().int().positive() });

const ACTIONS = {
  'lancer-conception': () => ({ type: 'LANCER_CONCEPTION' }),
  'lancer-design': () => ({ type: 'LANCER_DESIGN' }),
  'lancer-dev': () => ({ type: 'LANCER_DEV' }),
  'deployer-prod': (corps: unknown) => ({
    type: 'DEPLOYER_PROD',
    confirmation: z.object({ confirmation: z.boolean().default(false) }).parse(corps ?? {}).confirmation,
  }),
  relancer: () => ({ type: 'RELANCER' }),
} satisfies Record<string, (corps: unknown) => Evenement>;

const actionSchema = idSchema.extend({ action: z.enum(Object.keys(ACTIONS) as [keyof typeof ACTIONS]) });

export function enregistrerRoutesApi(app: FastifyInstance, service: ServiceTickets, depots: Depots, diffuseur: Diffuseur, lireMaquette: LecteurMaquette): void {
  app.get('/api/projets', async () => depots.projets.lister());

  app.get('/api/quota', async () => depots.quota.lire());

  app.get('/api/tickets', async () => service.lister());

  app.post('/api/tickets', async (requete, reponse) => {
    const ticket = service.creer(saisieSchema.parse(requete.body));
    return reponse.code(201).send(ticket);
  });

  app.get('/api/tickets/:id', async (requete) => service.lire(idSchema.parse(requete.params).id));

  app.patch('/api/tickets/:id', async (requete) => {
    const { id } = idSchema.parse(requete.params);
    return service.modifier(id, saisieSchema.parse(requete.body));
  });

  /**
   * Corrections à la main, sans changer de colonne. La validation du corps et les règles métier
   * (colonne, run en cours, versions, journal) sont dans le service, pas ici.
   */
  app.patch('/api/tickets/:id/spec', async (requete) => service.corrigerSpec(idSchema.parse(requete.params).id, requete.body));

  app.patch('/api/tickets/:id/design', async (requete) => service.corrigerDesign(idSchema.parse(requete.params).id, requete.body));

  app.delete('/api/tickets/:id', async (requete, reponse) => {
    service.supprimer(idSchema.parse(requete.params).id);
    return reponse.code(204).send();
  });

  /** Commentaires : retours sur la spec, le design ou les tests. Ce ne sont pas des transitions. */
  app.post('/api/tickets/:id/commentaires', async (requete, reponse) => {
    const ticket = await service.commenter(idSchema.parse(requete.params).id, requete.body);
    return reponse.code(201).send(ticket);
  });

  app.delete('/api/tickets/:id/commentaires/:commentaireId', async (requete) => {
    const { id, commentaireId } = commentaireParamsSchema.parse(requete.params);
    return service.supprimerCommentaire(id, commentaireId);
  });

  app.get('/api/tickets/:id/journal', async (requete) => {
    const { id } = idSchema.parse(requete.params);
    service.lire(id);
    return depots.tickets.journal(id);
  });

  /** Maquette du ticket, servie isolée pour s'afficher dans la fiche. */
  app.get('/api/tickets/:id/maquette', async (requete, reponse) => {
    const ticket = service.lire(idSchema.parse(requete.params).id);
    let html: string;
    let statut = 200;
    try {
      html = await lireMaquette(ticket);
    } catch (erreur) {
      if (!(erreur instanceof ErreurMaquette)) requete.log.error(erreur);
      html = pageErreurMaquette(erreur instanceof ErreurMaquette ? erreur.message : 'Une erreur inattendue est survenue.');
      statut = 502;
    }
    return reponse
      .code(statut)
      .header('Content-Type', 'text/html; charset=utf-8')
      .header('Content-Security-Policy', POLITIQUE_MAQUETTE)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'no-referrer')
      .header('Cache-Control', 'private, no-store')
      .send(html);
  });

  app.post('/api/tickets/:id/actions/:action', async (requete) => {
    const { id, action } = actionSchema.parse(requete.params);
    return service.agir(id, ACTIONS[action](requete.body));
  });

  app.patch('/api/tickets/:id/scenarios/:ordre', async (requete) => {
    const { id, ordre } = scenarioParamsSchema.parse(requete.params);
    const { fait } = z.object({ fait: z.boolean() }).parse(requete.body);
    return service.marquerScenario(id, ordre, fait);
  });

  /** Flux SSE : le tableau se met à jour sans recharger la page. */
  app.get('/api/flux', (requete, reponse) => {
    reponse.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reponse.raw.write('retry: 3000\n\n');
    const desabonner = diffuseur.abonner((message) => {
      reponse.raw.write(`data: ${JSON.stringify(message)}\n\n`);
    });
    const battement = setInterval(() => reponse.raw.write(': battement\n\n'), 25_000);
    requete.raw.on('close', () => {
      clearInterval(battement);
      desabonner();
    });
    reponse.hijack();
  });
}

/** Erreurs uniformes, en français, sans détail technique inutile pour l'interface. */
export function enregistrerGestionErreurs(app: FastifyInstance): void {
  app.setErrorHandler((erreur, requete, reponse) => {
    if (erreur instanceof ErreurMetier) {
      return reponse.code(erreur.statut).send({ code: erreur.code, message: erreur.message });
    }
    if (erreur instanceof z.ZodError) {
      const message = erreur.issues[0]?.message ?? 'Données invalides.';
      return reponse.code(400).send({ code: 'DONNEES_INVALIDES', message, details: erreur.issues });
    }
    const statut = (erreur as { statusCode?: number }).statusCode;
    if (statut && statut < 500) {
      return reponse.code(statut).send({ code: 'REQUETE_INVALIDE', message: 'Requête invalide.' });
    }
    requete.log.error(erreur);
    return reponse.code(500).send({ code: 'ERREUR_INTERNE', message: 'Une erreur inattendue est survenue.' });
  });

  app.setNotFoundHandler((_requete, reponse) => reponse.code(404).send({ code: 'INTROUVABLE', message: 'Page introuvable.' }));
}
