import { afterEach, describe, expect, it } from 'vitest';
import { signer } from '../../src/serveur/relais/signature';
import { SECRET_TEST, agir, creerAppTest, creerTicket, type AppTest } from './outils';

describe('API : bugs', () => {
  let app: AppTest;
  afterEach(async () => app.serveur.close());

  it('crée une fonctionnalité par défaut, et un bug sur demande', async () => {
    app = creerAppTest();
    const fonctionnalite = await creerTicket(app);
    const bug = await creerTicket(app, { titre: 'Le bouton Envoyer reste grisé', nature: 'bug' });
    expect(fonctionnalite).toMatchObject({ nature: 'fonctionnalite', origine: 'utilisatrice', trouveSur: null });
    expect(bug).toMatchObject({ nature: 'bug', origine: 'utilisatrice', colonne: 'backlog' });
  });

  it('refuse une nature inconnue', async () => {
    app = creerAppTest();
    const r = await app.serveur.inject({ method: 'POST', url: '/api/tickets', payload: { titre: 'x', nature: 'chantier' } });
    expect(r.statusCode).toBe(400);
  });

  it('lance la correction d’un bug : il passe en dev et la session de dev démarre', async () => {
    app = creerAppTest();
    const { id } = await creerTicket(app, { nature: 'bug', titre: 'Date décalée dans le planning' });
    const r = await agir(app, id, 'lancer-correction');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ colonne: 'dev', runEnCours: 'dev', branche: `claude/${id}-date-decalee-dans-le-planning` });
    expect(app.claude.dernierRun().type).toBe('dev');
    expect(app.claude.demandes.at(-1)!.ticket.nature).toBe('bug');
  });

  it('refuse la conception d’un bug et la correction d’une fonctionnalité, en 409', async () => {
    app = creerAppTest();
    const bug = await creerTicket(app, { nature: 'bug' });
    const fonctionnalite = await creerTicket(app);
    expect((await agir(app, bug.id, 'lancer-conception')).statusCode).toBe(409);
    expect((await agir(app, fonctionnalite.id, 'lancer-correction')).statusCode).toBe(409);
    expect(app.claude.demandes).toHaveLength(0);
  });

  it('garde la nature quand une modification ne la précise pas', async () => {
    app = creerAppTest();
    const { id } = await creerTicket(app, { nature: 'bug' });
    const r = await app.serveur.inject({ method: 'PATCH', url: `/api/tickets/${id}`, payload: { titre: 'Nouveau titre', description: 'd', projetId: 3 } });
    expect(r.json()).toMatchObject({ titre: 'Nouveau titre', nature: 'bug' });
  });
});

describe('relais : bug trouvé par l’agent de test', () => {
  let app: AppTest;
  afterEach(async () => app.serveur.close());

  const poster = (corps: object, secret = SECRET_TEST) => {
    const brut = JSON.stringify(corps);
    return app.serveur.inject({
      method: 'POST',
      url: '/relais/webhooks/bug',
      headers: { 'content-type': 'application/json', 'x-signature': signer(brut, secret) },
      payload: brut,
    });
  };

  async function ticketEnDev() {
    app = creerAppTest();
    const { id } = await creerTicket(app, { titre: 'Fiche personnage' });
    await agir(app, id, 'lancer-conception');
    await app.service.recevoir(app.claude.dernierRun().id, { type: 'SPEC_PRETE', spec: '# Spec' });
    await app.service.recevoir(app.claude.dernierRun().id, { type: 'DESIGN_PRET', resume: '# Design', urlMaquette: 'https://exemple.fr/m.html' });
    await agir(app, id, 'lancer-dev');
    return { id, runId: app.claude.dernierRun().id };
  }

  const BUG = { titre: 'Jet de dés affiché deux fois', description: 'Après un jet, le résultat apparaît deux fois dans le journal.' };

  it('crée un bug dans le backlog du même projet, sans le lancer', async () => {
    const { id, runId } = await ticketEnDev();
    const lances = app.claude.demandes.length;
    const r = await poster({ runId, bug: BUG });
    expect(r.statusCode).toBe(201);
    const cree = app.service.lire(r.json().id);
    expect(cree).toMatchObject({ ...BUG, nature: 'bug', origine: 'agent', trouveSur: id, colonne: 'backlog', projetId: 3, runEnCours: null });
    expect(app.claude.demandes).toHaveLength(lances);
    expect(app.depots.tickets.journal(cree.id).map((e) => e.detail)).toContain('Bug trouvé par l’agent de test pendant le dev de « Fiche personnage ».');
    expect(app.depots.tickets.journal(id).map((e) => e.detail)).toContain(`L’agent de test a signalé un bug hors du périmètre : « ${BUG.titre} » (ticket ${cree.id}).`);
    // Le ticket d'origine continue son dev.
    expect(app.service.lire(id)).toMatchObject({ colonne: 'dev', runEnCours: 'dev' });
  });

  it('ignore un doublon envoyé deux fois', async () => {
    const { runId } = await ticketEnDev();
    const premier = await poster({ runId, bug: BUG });
    const second = await poster({ runId, bug: BUG });
    expect(second.statusCode).toBe(200);
    expect(second.json().id).toBe(premier.json().id);
    expect(app.service.lister().filter((t) => t.nature === 'bug')).toHaveLength(1);
  });

  it('rejette une signature fausse', async () => {
    const { runId } = await ticketEnDev();
    expect((await poster({ runId, bug: BUG }, 'mauvais'.padEnd(40, 'z'))).statusCode).toBe(401);
  });

  it('refuse un run qui n’est pas un dev en cours', async () => {
    app = creerAppTest();
    const { id } = await creerTicket(app);
    await agir(app, id, 'lancer-conception');
    const r = await poster({ runId: app.claude.dernierRun().id, bug: BUG });
    expect(r.statusCode).toBe(409);
    expect((await poster({ runId: 'inconnu', bug: BUG })).statusCode).toBe(404);
  });

  it('refuse un titre vide', async () => {
    const { runId } = await ticketEnDev();
    expect((await poster({ runId, bug: { titre: ' ', description: 'x' } })).statusCode).toBe(400);
  });

  it('limite le nombre de bugs ouverts signalés depuis un même ticket', async () => {
    const { runId } = await ticketEnDev();
    for (let i = 1; i <= 10; i++) expect((await poster({ runId, bug: { titre: `Bug ${i}`, description: 'x' } })).statusCode).toBe(201);
    expect((await poster({ runId, bug: { titre: 'Bug 11', description: 'x' } })).statusCode).toBe(429);
  });
});
