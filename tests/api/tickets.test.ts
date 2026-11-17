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
    expect(r.json().map((p: { nom: string }) => p.nom)).toEqual(['Demandez le programme', 'Interface JDR', 'Optivie']);
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
    expect(journal.map((j: { detail: string }) => j.detail)).toContain('Session Claude démarrée : https://claude.ai/code/session-test');
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

    // La spec prête enchaîne seule sur le design, sur la branche fixée en conception.
    const runDesign = app.claude.dernierRun();
    expect(runDesign.type).toBe('design');
    expect(app.claude.demandes.at(-1)?.ticket.branche).toBe('claude/1-planning-des-benevoles');
    expect((await agir(app, id, 'lancer-dev')).statusCode).toBe(409);
    r = await app.service.recevoir(runDesign.id, { type: 'DESIGN_PRET', resume: '# Écrans', urlMaquette: 'https://github.com/o/r/blob/b/m.html' });
    expect(r).toMatchObject({ ignore: false, ticket: { designVersion: 1, runEnCours: null } });
    expect(app.depots.runs.lire(runDesign.id)?.statut).toBe('termine');

    const dev = await agir(app, id, 'lancer-dev');
    expect(dev.json()).toMatchObject({ colonne: 'dev', branche: 'claude/1-planning-des-benevoles' });
    const runDev = app.claude.dernierRun();

    await app.service.recevoir(runDev.id, { type: 'ITERATION_TERMINEE', iteration: 1, controles: { ...TOUT_VERT, exploratoire: 'rouge' } });
    r = await app.service.recevoir(runDev.id, { type: 'DEV_TERMINE', controles: TOUT_VERT, scenarios: SCENARIOS });
    expect(r).toMatchObject({ ignore: false, ticket: { colonne: 'dev', runEnCours: 'preprod', iteration: 1 } });
    expect(app.depots.runs.lire(runDev.id)?.statut).toBe('termine');

    // La préprod passe par le pipeline du projet, avec le projet et sa branche principale.
    const runPreprod = app.deploiement.dernierRun();
    expect(runPreprod.type).toBe('preprod');
    expect(app.deploiement.demandes.at(-1)?.projet).toMatchObject({ depot: 'orphane-a/optivie', branchePrincipale: 'master' });
    r = await app.service.recevoir(runPreprod.id, { type: 'PREPROD_DEPLOYEE', urlPreprod: 'https://preprod.optivie.orphane.fr', version: 'a1b2c3d' });
    expect(r).toMatchObject({ ignore: false, ticket: { colonne: 'test', urlPreprod: 'https://preprod.optivie.orphane.fr' } });

    const coche = await app.serveur.inject({ method: 'PATCH', url: `/api/tickets/${id}/scenarios/1`, payload: { fait: true } });
    expect(coche.json().scenarios[0].fait).toBe(true);

    expect((await agir(app, id, 'deployer-prod')).statusCode).toBe(409);
    const prod = await agir(app, id, 'deployer-prod', { confirmation: true });
    expect(prod.json().colonne).toBe('deploiement');
    expect(app.deploiement.demandes).toHaveLength(2);
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

  it('un design en échec se relance seul, sans réécrire la spec', async () => {
    const { id } = await creerTicket(app);
    await agir(app, id, 'lancer-conception');
    await app.service.recevoir(app.claude.dernierRun().id, { type: 'SPEC_PRETE', spec: '# Spec' });
    await app.service.recevoir(app.claude.dernierRun().id, { type: 'ECHEC', motif: 'Maquette impossible.' });
    expect(app.service.lire(id).blocage?.motif).toBe('Maquette impossible.');
    const relance = await agir(app, id, 'relancer');
    expect(relance.json()).toMatchObject({ runEnCours: 'design', spec: '# Spec' });
    expect(app.claude.dernierRun().type).toBe('design');
  });

  it('lance le design d’un ticket repris avec une spec mais sans maquette', async () => {
    const { id } = await creerTicket(app);
    await agir(app, id, 'lancer-conception');
    await app.service.recevoir(app.claude.dernierRun().id, { type: 'SPEC_PRETE', spec: '# Spec' });
    await app.service.recevoir(app.claude.dernierRun().id, { type: 'ECHEC', motif: 'x' });
    // Simule un ticket importé : spec présente, aucun design, aucun blocage.
    app.depots.tickets.sauver({ ...app.service.lire(id), blocage: null }, []);
    const r = await agir(app, id, 'lancer-design');
    expect(r.json()).toMatchObject({ runEnCours: 'design' });
  });

  it('les scénarios ne se cochent qu’en phase de test', async () => {
    const { id } = await creerTicket(app);
    const r = await app.serveur.inject({ method: 'PATCH', url: `/api/tickets/${id}/scenarios/1`, payload: { fait: true } });
    expect(r.statusCode).toBe(409);
  });
});

describe('une seule préprod par projet', () => {
  /** Mène un ticket jusqu'à la fin du dev et renvoie son identifiant. */
  async function jusquaFinDuDev(projetId: number, titre: string) {
    const { id } = await creerTicket(app, { titre, projetId });
    await agir(app, id, 'lancer-conception');
    await app.service.recevoir(app.claude.dernierRun().id, { type: 'SPEC_PRETE', spec: '# Spec' });
    await app.service.recevoir(app.claude.dernierRun().id, { type: 'DESIGN_PRET', resume: '# D', urlMaquette: 'https://github.com/o/r/blob/b/m.html' });
    await agir(app, id, 'lancer-dev');
    await app.service.recevoir(app.claude.dernierRun().id, { type: 'DEV_TERMINE', controles: TOUT_VERT, scenarios: SCENARIOS });
    return id;
  }

  it('bloque le deuxième ticket du projet, puis la relance part quand la préprod se libère', async () => {
    const premier = await jusquaFinDuDev(3, 'Premier');
    await app.service.recevoir(app.deploiement.dernierRun().id, { type: 'PREPROD_DEPLOYEE', urlPreprod: 'https://preprod.optivie.orphane.fr', version: 'a1' });
    expect(app.service.lire(premier).colonne).toBe('test');

    const second = await jusquaFinDuDev(3, 'Second');
    expect(app.service.lire(second)).toMatchObject({ colonne: 'dev', runEnCours: null, blocage: { motif: `Préprod occupée par le ticket ${premier}.` } });
    expect(app.deploiement.demandes).toHaveLength(1);

    // Tant que le premier est en test, la relance est refusée.
    const refus = await agir(app, second, 'relancer');
    expect(refus.statusCode).toBe(409);
    expect(refus.json().message).toBe(`Préprod occupée par le ticket ${premier}.`);

    // Le premier part en prod : la préprod est libre, la relance ne refait que la préprod.
    await agir(app, premier, 'deployer-prod', { confirmation: true });
    const relance = await agir(app, second, 'relancer');
    expect(relance.json()).toMatchObject({ colonne: 'dev', runEnCours: 'preprod', blocage: null });
    expect(app.deploiement.dernierRun().type).toBe('preprod');
  });

  it('deux projets différents ont chacun leur préprod', async () => {
    await jusquaFinDuDev(3, 'Optivie');
    const autre = await jusquaFinDuDev(4, 'Programme');
    expect(app.service.lire(autre)).toMatchObject({ runEnCours: 'preprod', blocage: null });
  });
});

describe('surveillance des sessions silencieuses', () => {
  it('bloque un run sans nouvelles au delà du délai, avec le lien de la session', async () => {
    const { id } = await creerTicket(app);
    await agir(app, id, 'lancer-conception');
    const run = app.claude.dernierRun();

    // L'horloge de test avance d'une seconde par lecture : 0 minute de silence suffit à déclencher.
    expect(await app.service.surveillerSilences(60)).toBe(0);
    expect(await app.service.surveillerSilences(0)).toBe(1);

    const t = app.service.lire(id);
    expect(t.colonne).toBe('conception');
    expect(t.blocage).toMatchObject({ cause: 'echec' });
    expect(t.blocage?.motif).toContain('https://claude.ai/code/session-test');
    expect(app.depots.runs.lire(run.id)?.statut).toBe('echoue');
    // Il ne repart jamais seul.
    expect(await app.service.surveillerSilences(0)).toBe(0);
    expect(app.claude.demandes).toHaveLength(1);
  });

  it('chaque webhook reçu repousse le délai', async () => {
    const { id } = await creerTicket(app);
    await agir(app, id, 'lancer-conception');
    const run = app.claude.dernierRun();
    await app.service.recevoir(run.id, { type: 'SPEC_PRETE', spec: '# Spec' });
    const design = app.depots.runs.lire(app.claude.dernierRun().id)!;
    expect(design.derniereNouvelle > run.debut).toBe(true);
    expect(await app.service.surveillerSilences(60)).toBe(0);
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
