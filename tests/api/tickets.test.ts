import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QuotaAtteintErreur } from '../../src/serveur/relais/executeur';
import { SCENARIOS, TOUT_VERT, agir, creerAppTest, creerTicket, type AppTest } from './outils';

let app: AppTest;

beforeEach(() => {
  app = creerAppTest();
});

afterEach(async () => {
  await app.serveur.close();
});

describe('projets et quota', () => {
  it('liste les projets de départ', async () => {
    const r = await app.serveur.inject('/api/projets');
    expect(r.json().map((p: { nom: string }) => p.nom)).toEqual(['AMLF', 'Interface JDR']);
  });

  it('renvoie le quota initial', async () => {
    const r = await app.serveur.inject('/api/quota');
    expect(r.json()).toMatchObject({ pourcentageSemaine: 0, epuise: false });
  });
});

describe('backlog manuel', () => {
  it('crée un ticket dans le backlog et le journalise', async () => {
    const ticket = await creerTicket(app);
    expect(ticket).toMatchObject({ id: 1, colonne: 'backlog', titre: 'Planning des bénévoles', iterationMax: 5, blocage: null });
    const journal = await app.serveur.inject(`/api/tickets/${ticket.id}/journal`);
    expect(journal.json()[0]).toMatchObject({ type: 'action', detail: 'Ticket ajouté au backlog.' });
  });

  it('ignore une colonne envoyée à la création : seul le backlog accepte la création', async () => {
    const ticket = await creerTicket(app, { colonne: 'done' });
    expect(ticket.colonne).toBe('backlog');
  });

  it('refuse un titre vide avec un message en français', async () => {
    const r = await app.serveur.inject({ method: 'POST', url: '/api/tickets', payload: { titre: '  ' } });
    expect(r.statusCode).toBe(400);
    expect(r.json().message).toBe('Le titre est obligatoire.');
  });

  it('refuse un projet inconnu', async () => {
    const r = await app.serveur.inject({ method: 'POST', url: '/api/tickets', payload: { titre: 'x', projetId: 99 } });
    expect(r.statusCode).toBe(400);
  });

  it('modifie puis supprime un ticket du backlog', async () => {
    const { id } = await creerTicket(app);
    const modif = await app.serveur.inject({ method: 'PATCH', url: `/api/tickets/${id}`, payload: { titre: 'Nouveau titre', description: 'd', projetId: 2 } });
    expect(modif.json()).toMatchObject({ titre: 'Nouveau titre', projetId: 2 });
    const suppression = await app.serveur.inject({ method: 'DELETE', url: `/api/tickets/${id}` });
    expect(suppression.statusCode).toBe(204);
    expect((await app.serveur.inject(`/api/tickets/${id}`)).statusCode).toBe(404);
  });

  it('refuse de modifier ou supprimer un ticket sorti du backlog', async () => {
    const { id } = await creerTicket(app);
    await agir(app, id, 'lancer-conception');
    const modif = await app.serveur.inject({ method: 'PATCH', url: `/api/tickets/${id}`, payload: { titre: 'x' } });
    expect(modif.statusCode).toBe(409);
    const suppression = await app.serveur.inject({ method: 'DELETE', url: `/api/tickets/${id}` });
    expect(suppression.statusCode).toBe(409);
  });

  it('renvoie 404 pour un ticket inconnu', async () => {
    const r = await app.serveur.inject('/api/tickets/42');
    expect(r.statusCode).toBe(404);
    expect(r.json().message).toBe('Ticket introuvable.');
  });
});

describe('actions de l’utilisatrice', () => {
  it('lance la conception et démarre un run spec', async () => {
    const { id } = await creerTicket(app);
    const r = await agir(app, id, 'lancer-conception');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ colonne: 'conception', runEnCours: 'spec' });
    expect(app.claude.demandes).toHaveLength(1);
    expect(app.claude.dernierRun()).toMatchObject({ type: 'spec', statut: 'en_cours', ticketId: id });
    const journal = (await app.serveur.inject(`/api/tickets/${id}/journal`)).json();
    expect(journal.map((j: { detail: string }) => j.detail)).toContain('Session démarrée : https://claude.ai/code/session-test');
  });

  it('refuse Lancer le dev sans spec, en 409 avec le code de la machine', async () => {
    const { id } = await creerTicket(app);
    await agir(app, id, 'lancer-conception');
    const r = await agir(app, id, 'lancer-dev');
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe('CONDITION_NON_REMPLIE');
  });

  it('refuse une action inconnue', async () => {
    const { id } = await creerTicket(app);
    expect((await agir(app, id, 'sauter-en-prod')).statusCode).toBe(400);
  });

  it('refuse un saut de colonne : déployer depuis le backlog', async () => {
    const { id } = await creerTicket(app);
    const r = await agir(app, id, 'deployer-prod', { confirmation: true });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe('TRANSITION_INTERDITE');
  });

  it('bloque le ticket si le lancement échoue', async () => {
    const { id } = await creerTicket(app);
    app.claude.comportement = async () => {
      throw new Error('réseau indisponible');
    };
    const r = await agir(app, id, 'lancer-conception');
    expect(r.json()).toMatchObject({ colonne: 'conception', runEnCours: null, blocage: { cause: 'echec' } });
    expect(r.json().blocage.motif).toContain('réseau indisponible');
    expect(r.json().description).toBe('Voir qui est disponible.');
  });

  it('bloque le ticket et marque le quota épuisé si Claude refuse pour quota', async () => {
    const { id } = await creerTicket(app);
    app.claude.comportement = async () => {
      throw new QuotaAtteintErreur('2026-11-17T15:00:00.000Z');
    };
    const r = await agir(app, id, 'lancer-conception');
    expect(r.json().blocage).toMatchObject({ motif: 'Quota Claude atteint', cause: 'quota', repriseEstimee: '2026-11-17T15:00:00.000Z' });
    expect((await app.serveur.inject('/api/quota')).json()).toMatchObject({ epuise: true, repriseEstimee: '2026-11-17T15:00:00.000Z' });
  });

  it('relancer un ticket bloqué par quota rétablit le quota et relance le run', async () => {
    const { id } = await creerTicket(app);
    app.claude.comportement = async () => {
      throw new QuotaAtteintErreur(null);
    };
    await agir(app, id, 'lancer-conception');
    app.claude.comportement = async () => ({});
    const r = await agir(app, id, 'relancer');
    expect(r.json()).toMatchObject({ blocage: null, runEnCours: 'spec' });
    expect((await app.serveur.inject('/api/quota')).json().epuise).toBe(false);
    expect(app.claude.demandes).toHaveLength(2);
  });
});

describe('parcours complet jusqu’en Done', () => {
  it('suit chaque étape et refuse les runs périmés ou déjà clos', async () => {
    const { id } = await creerTicket(app);
    await agir(app, id, 'lancer-conception');
    const runSpec = app.claude.dernierRun();

    let r = await app.service.recevoir(runSpec.id, { type: 'SPEC_PRETE', spec: '# Planning\n\nExigences.' });
    expect(r).toMatchObject({ ignore: false, ticket: { specVersion: 1 } });
    expect(app.depots.runs.lire(runSpec.id)?.statut).toBe('termine');

    // Un deuxième webhook pour le même run est ignoré : idempotence.
    expect(await app.service.recevoir(runSpec.id, { type: 'SPEC_PRETE', spec: 'bis' })).toMatchObject({ ignore: true });

    const dev = await agir(app, id, 'lancer-dev');
    expect(dev.json()).toMatchObject({ colonne: 'dev', branche: 'claude/1-planning-des-benevoles' });
    const runDev = app.claude.dernierRun();

    await app.service.recevoir(runDev.id, { type: 'ITERATION_TERMINEE', iteration: 1, controles: { ...TOUT_VERT, exploratoire: 'rouge' } });
    r = await app.service.recevoir(runDev.id, { type: 'DEV_TERMINE', urlPreprod: 'https://preprod.amlf.fr', controles: TOUT_VERT, scenarios: SCENARIOS });
    expect(r).toMatchObject({ ignore: false, ticket: { colonne: 'test', iteration: 1 } });

    const coche = await app.serveur.inject({ method: 'PATCH', url: `/api/tickets/${id}/scenarios/1`, payload: { fait: true } });
    expect(coche.json().scenarios[0].fait).toBe(true);

    expect((await agir(app, id, 'deployer-prod')).statusCode).toBe(409);
    const prod = await agir(app, id, 'deployer-prod', { confirmation: true });
    expect(prod.json().colonne).toBe('deploiement');
    expect(app.deploiement.demandes).toHaveLength(1);
    const runProd = app.deploiement.dernierRun();

    await app.service.recevoir(runProd.id, { type: 'ETAPE_DEPLOIEMENT', etapes: { fusion: 'vert', envoi: 'en_cours', verification: 'en_attente' } });
    r = await app.service.recevoir(runProd.id, { type: 'DEPLOIEMENT_TERMINE', version: 'v1.0.0' });
    expect(r).toMatchObject({ ignore: false, ticket: { colonne: 'done', versionDeployee: 'v1.0.0' } });

    const journal = (await app.serveur.inject(`/api/tickets/${id}/journal`)).json() as { type: string; detail: string }[];
    const passages = journal.filter((j) => j.type === 'transition').map((j) => j.detail);
    expect(passages).toEqual([
      'Passage de Backlog à En conception.',
      'Passage de En conception à En dev.',
      'Passage de En dev à En test.',
      'Passage de En test à Déploiement en prod.',
      'Passage de Déploiement en prod à Done.',
    ]);
  });

  it('un webhook d’un ancien run est ignoré après une relance', async () => {
    const { id } = await creerTicket(app);
    await agir(app, id, 'lancer-conception');
    const ancien = app.claude.dernierRun();
    await app.service.recevoir(ancien.id, { type: 'ECHEC', motif: 'Erreur' });
    await agir(app, id, 'relancer');
    const nouveau = app.claude.dernierRun();
    expect(nouveau.id).not.toBe(ancien.id);
    expect(await app.service.recevoir(ancien.id, { type: 'SPEC_PRETE', spec: '# vieux' })).toMatchObject({ ignore: true });
    expect((await app.service.recevoir(nouveau.id, { type: 'SPEC_PRETE', spec: '# neuf' })).ignore).toBe(false);
  });

  it('les scénarios ne se cochent qu’en phase de test', async () => {
    const { id } = await creerTicket(app);
    const r = await app.serveur.inject({ method: 'PATCH', url: `/api/tickets/${id}/scenarios/1`, payload: { fait: true } });
    expect(r.statusCode).toBe(409);
  });
});

describe('flux SSE', () => {
  it('diffuse chaque changement de ticket', async () => {
    const recus: string[] = [];
    const desabonner = app.diffuseur.abonner((m) => recus.push(m.type));
    const { id } = await creerTicket(app);
    await agir(app, id, 'lancer-conception');
    desabonner();
    expect(recus.filter((t) => t === 'ticket').length).toBeGreaterThanOrEqual(2);
  });
});
