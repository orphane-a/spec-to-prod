import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { evenementSchema, type TypeEvenement, type TypeRun } from '../../domaine/types';
import type { Depots } from '../base/depots';
import type { Diffuseur } from '../diffuseur';
import { ErreurMetier } from '../erreurs';
import type { Horloge, ServiceTickets } from '../service-tickets';
import { ENTETE_SIGNATURE, verifierSignature } from './signature';

const corpsSchema = z.object({
  runId: z.string().min(1),
  evenement: evenementSchema,
  /** Pourcentage du quota hebdomadaire observé par la session, quand elle le connaît. */
  quota: z.object({ pourcentageSemaine: z.number().min(0).max(100) }).optional(),
});

interface Source {
  chemin: string;
  runs: readonly TypeRun[];
  evenements: readonly TypeEvenement[];
}

export const SOURCES: Record<'claude' | 'pipeline', Source> = {
  claude: {
    chemin: '/relais/webhooks/claude',
    runs: ['spec', 'design', 'dev'],
    evenements: ['SPEC_PRETE', 'DESIGN_PRET', 'ITERATION_TERMINEE', 'DEV_TERMINE', 'ECHEC', 'QUOTA_ATTEINT'],
  },
  pipeline: {
    chemin: '/relais/webhooks/pipeline',
    runs: ['preprod', 'deploiement'],
    evenements: ['PREPROD_DEPLOYEE', 'ETAPE_DEPLOIEMENT', 'DEPLOIEMENT_TERMINE', 'ECHEC'],
  },
};

/**
 * Reçoit les fins de run (session Claude Code, pipeline GitHub Actions).
 * Chaque appel doit être signé avec le secret partagé, sinon il est rejeté.
 */
export function enregistrerWebhooks(
  app: FastifyInstance,
  options: { secret: string; service: ServiceTickets; depots: Depots; diffuseur: Diffuseur; horloge: Horloge },
): void {
  app.register(async (portee) => {
    // Le corps brut est nécessaire pour vérifier la signature.
    portee.addContentTypeParser('application/json', { parseAs: 'string' }, (_requete, corps, terminer) => terminer(null, corps));

    for (const source of Object.values(SOURCES)) {
      portee.post(source.chemin, async (requete) => {
        const brut = typeof requete.body === 'string' ? requete.body : '';
        const entete = requete.headers[ENTETE_SIGNATURE];
        if (!verifierSignature(brut, Array.isArray(entete) ? entete[0] : entete, options.secret)) {
          throw new ErreurMetier(401, 'SIGNATURE_INVALIDE', 'Signature absente ou invalide.');
        }

        let json: unknown;
        try {
          json = JSON.parse(brut);
        } catch {
          throw new ErreurMetier(400, 'DONNEES_INVALIDES', 'Le corps doit être du JSON.');
        }
        const { runId, evenement, quota } = corpsSchema.parse(json);

        if (!source.evenements.includes(evenement.type)) {
          throw new ErreurMetier(400, 'EVENEMENT_REFUSE', `Événement ${evenement.type} non accepté sur ce webhook.`);
        }
        const run = options.depots.runs.lire(runId);
        if (!run) throw new ErreurMetier(404, 'INTROUVABLE', 'Run introuvable.');
        if (!source.runs.includes(run.type)) {
          throw new ErreurMetier(400, 'EVENEMENT_REFUSE', 'Ce run ne dépend pas de ce webhook.');
        }

        if (quota) {
          const actuel = options.depots.quota.lire();
          const misAJour = options.depots.quota.ecrire({ ...actuel, pourcentageSemaine: quota.pourcentageSemaine }, options.horloge());
          options.diffuseur.publier({ type: 'quota', quota: misAJour });
        }

        const resultat = await options.service.recevoir(runId, evenement);
        return resultat.ignore ? { ignore: true, raison: resultat.raison } : { ignore: false, colonne: resultat.ticket.colonne };
      });
    }
  });
}
