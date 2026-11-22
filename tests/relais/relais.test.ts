import { afterEach, describe, expect, it } from 'vitest';
import { creerApp } from '../../src/serveur/app';
import { signer, verifierSignature } from '../../src/serveur/relais/signature';
import { Simulation, type Envoyer } from '../../src/serveur/relais/simule';
import type { Ticket } from '../../src/domaine/types';
import { SCENARIOS, SECRET_TEST, TOUT_VERT, agir, creerAppTest, creerTicket, type AppTest } from '../api/outils';

describe('signature HMAC', () => {
  it('accepte la bonne signature et refuse le reste', () => {
    const corps = '{"a":1}';
    const signature = signer(corps, SECRET_TEST);
    expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(verifierSignature(corps, signature, SECRET_TEST)).toBe(true);
    expect(verifierSignature('{"a":2}', signature, SECRET_TEST)).toBe(false);
    expect(verifierSignature(corps, signature, 'autre-secret'.padEnd(40, 'y'))).toBe(false);
    expect(verifierSignature(corps, undefined, SECRET_TEST)).toBe(false);
    expect(verifierSignature(corps, 'sha256=court', SECRET_TEST)).toBe(false);
  });
});

describe('webhooks', () => {
  let app: AppTest;
  afterEach(async () => app.serveur.close());

  const poster = (chemin: string, corps: object, secret = SECRET_TEST) => {
    const brut = JSON.stringify(corps);
    return app.serveur.inject({
      method: 'POST',
      url: chemin,
      headers: { 'content-type': 'application/json', 'x-signature': signer(brut, secret) },
      payload: brut,
    });
  };

  async function ticketEnConception() {
    app = creerAppTest();
    const { id } = await creerTicket(app);
    await agir(app, id, 'lancer-conception');
    return { id, runId: app.claude.dernierRun().id };
  }

  it('applique un événement signé', async () => {
    const { id, runId } = await ticketEnConception();
    const r = await poster('/relais/webhooks/claude', { runId, evenement: { type: 'SPEC_PRETE', spec: '# Spec' } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ignore: false, colonne: 'conception' });
    expect(app.service.lire(id).spec).toBe('# Spec');
  });

  it('rejette une signature absente ou fausse', async () => {
    const { id, runId } = await ticketEnConception();
    const sans = await app.serveur.inject({
      method: 'POST',
      url: '/relais/webhooks/claude',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ runId, evenement: { type: 'SPEC_PRETE', spec: '# x' } }),
    });
    expect(sans.statusCode).toBe(401);
    const fausse = await poster('/relais/webhooks/claude', { runId, evenement: { type: 'SPEC_PRETE', spec: '# x' } }, 'mauvais'.padEnd(40, 'z'));
    expect(fausse.statusCode).toBe(401);
    expect(app.service.lire(id).spec).toBe(null);
  });

  it('refuse un événement utilisatrice ou hors du périmètre du webhook', async () => {
    const { runId } = await ticketEnConception();
    expect((await poster('/relais/webhooks/claude', { runId, evenement: { type: 'DEPLOYER_PROD', confirmation: true } })).statusCode).toBe(400);
    expect((await poster('/relais/webhooks/claude', { runId, evenement: { type: 'LANCER_DEV' } })).statusCode).toBe(400);
    expect((await poster('/relais/webhooks/pipeline', { runId, evenement: { type: 'ECHEC', motif: 'x' } })).statusCode).toBe(400);
  });

  it('refuse un run inconnu et un corps mal formé', async () => {
    await ticketEnConception();
    expect((await poster('/relais/webhooks/claude', { runId: 'inconnu', evenement: { type: 'ECHEC', motif: 'x' } })).statusCode).toBe(404);
    expect((await poster('/relais/webhooks/claude', { evenement: { type: 'ECHEC' } })).statusCode).toBe(400);
  });

  it('ignore un doublon', async () => {
    const { runId } = await ticketEnConception();
    await poster('/relais/webhooks/claude', { runId, evenement: { type: 'SPEC_PRETE', spec: '# 1' } });
    const doublon = await poster('/relais/webhooks/claude', { runId, evenement: { type: 'SPEC_PRETE', spec: '# 1' } });
    expect(doublon.statusCode).toBe(200);
    expect(doublon.json().ignore).toBe(true);
  });

  it('refuse en 409 une transition interdite par la machine', async () => {
    const { runId } = await ticketEnConception();
    const r = await poster('/relais/webhooks/claude', { runId, evenement: { type: 'DEV_TERMINE', urlPreprod: 'https://p', controles: TOUT_VERT, scenarios: SCENARIOS } });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe('TRANSITION_INTERDITE');
  });

  it('met à jour la jauge de quota transmise', async () => {
    const { runId } = await ticketEnConception();
    await poster('/relais/webhooks/claude', { runId, evenement: { type: 'SPEC_PRETE', spec: '# x' }, quota: { pourcentageSemaine: 58 } });
    expect(app.depots.quota.lire().pourcentageSemaine).toBe(58);
  });
});

describe('mode simulé de bout en bout', () => {
  let arreter = () => {};
  afterEach(() => arreter());

  /** App réelle, faux Claude qui passe par les vrais webhooks signés (via inject). */
  function creerAppSimulee() {
    const envoi: { cible?: Envoyer } = {};
    const simulation = new Simulation({ delaiMs: 2, envoyer: (chemin, corps) => envoi.cible!(chemin, corps) });
    const app = creerApp({
      config: { BASE_CHEMIN: ':memory:', ITERATIONS_MAX: 5, WEBHOOK_SECRET: SECRET_TEST },
      executeurs: { claude: simulation.claude, deploiement: simulation.deploiement },
    });
    envoi.cible = async (chemin, corps) => {
      const brut = JSON.stringify(corps);
      const r = await app.serveur.inject({
        method: 'POST',
        url: chemin,
        headers: { 'content-type': 'application/json', 'x-signature': signer(brut, SECRET_TEST) },
        payload: brut,
      });
      if (r.statusCode >= 300) throw new Error(`${r.statusCode} ${r.body}`);
    };
    arreter = () => {
      simulation.arreter();
      void app.serveur.close();
    };
    return app;
  }

  async function attendre(app: ReturnType<typeof creerAppSimulee>, id: number, condition: (t: Ticket) => boolean): Promise<Ticket> {
    for (let i = 0; i < 400; i++) {
      const t = app.service.lire(id);
      if (condition(t)) return t;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error(`Condition jamais atteinte, état : ${JSON.stringify(app.service.lire(id))}`);
  }

  const agirSur = (app: ReturnType<typeof creerAppSimulee>, id: number, action: string, payload?: object) =>
    app.serveur.inject({ method: 'POST', url: `/api/tickets/${id}/actions/${action}`, payload });

  async function nouveauTicket(app: ReturnType<typeof creerAppSimulee>, description = 'Idée simple.') {
    const r = await app.serveur.inject({ method: 'POST', url: '/api/tickets', payload: { titre: 'Planning des bénévoles', description, projetId: 3 } });
    return r.json().id as number;
  }

  it('mène un ticket du backlog à Done, avec mes trois décisions seulement', async () => {
    const app = creerAppSimulee();
    const id = await nouveauTicket(app);

    await agirSur(app, id, 'lancer-conception');
    let t = await attendre(app, id, (x) => x.urlMaquette !== null);
    expect(t.colonne).toBe('conception');
    expect(t.spec).toContain('# Planning des bénévoles');

    await agirSur(app, id, 'lancer-dev');
    t = await attendre(app, id, (x) => x.colonne === 'test');
    expect(t.iteration).toBe(3);
    expect(t.scenarios).toHaveLength(3);
    expect(t.urlPreprod).toMatch(/^https:\/\/preprod\.exemple\.test\//);

    await agirSur(app, id, 'deployer-prod', { confirmation: true });
    t = await attendre(app, id, (x) => x.colonne === 'done');
    expect(t.versionDeployee).toBe(`v1.0.${id}`);
    expect(app.depots.quota.lire().pourcentageSemaine).toBeGreaterThan(12);
  });

  it('mène un bug du backlog à Done sans conception, avec deux décisions seulement', async () => {
    const app = creerAppSimulee();
    const r = await app.serveur.inject({
      method: 'POST',
      url: '/api/tickets',
      payload: { titre: 'Date décalée dans le planning', description: 'La date affichée a un jour de retard.', projetId: 3, nature: 'bug' },
    });
    const id = r.json().id as number;

    await agirSur(app, id, 'lancer-correction');
    let t = await attendre(app, id, (x) => x.colonne === 'test');
    expect(t.spec).toBe(null);
    expect(t.scenarios.map((s) => s.objectif)).toEqual(['Rejouer le bug', 'Vérifier le cas voisin']);

    await agirSur(app, id, 'deployer-prod', { confirmation: true });
    t = await attendre(app, id, (x) => x.colonne === 'done');
    expect(t.nature).toBe('bug');
  });

  it('#simu:bug-trouve : l’agent de test signale un bug qui attend dans le backlog', async () => {
    const app = creerAppSimulee();
    const id = await nouveauTicket(app, 'Idée #simu:bug-trouve');
    await agirSur(app, id, 'lancer-conception');
    await attendre(app, id, (x) => x.urlMaquette !== null);
    await agirSur(app, id, 'lancer-dev');
    await attendre(app, id, (x) => x.colonne === 'test');
    const bugs = app.service.lister().filter((x) => x.trouveSur === id);
    expect(bugs).toHaveLength(1);
    expect(bugs[0]).toMatchObject({ nature: 'bug', origine: 'agent', colonne: 'backlog', runEnCours: null });
  });

  it('ne passe jamais seul en prod : le ticket attend en test', async () => {
    const app = creerAppSimulee();
    const id = await nouveauTicket(app);
    await agirSur(app, id, 'lancer-conception');
    await attendre(app, id, (x) => x.urlMaquette !== null);
    await agirSur(app, id, 'lancer-dev');
    await attendre(app, id, (x) => x.colonne === 'test');
    await new Promise((r) => setTimeout(r, 50));
    expect(app.service.lire(id).colonne).toBe('test');
  });

  it('#simu:iterations bloque au maximum puis la relance aboutit', async () => {
    const app = creerAppSimulee();
    const id = await nouveauTicket(app, 'Export CSV #simu:iterations');
    await agirSur(app, id, 'lancer-conception');
    await attendre(app, id, (x) => x.urlMaquette !== null);
    await agirSur(app, id, 'lancer-dev');
    const bloque = await attendre(app, id, (x) => x.blocage !== null);
    expect(bloque.blocage?.motif).toBe('5 itérations atteintes, 2 contrôles échouent.');
    expect(bloque.colonne).toBe('dev');

    await agirSur(app, id, 'relancer');
    const repris = await attendre(app, id, (x) => x.colonne === 'test');
    expect(repris.blocage).toBe(null);
  });

  it('#simu:quota bloque avec « Quota Claude atteint » et ne repart jamais seul', async () => {
    const app = creerAppSimulee();
    const id = await nouveauTicket(app, 'Idée #simu:quota');
    const r = await agirSur(app, id, 'lancer-conception');
    expect(r.json().blocage).toMatchObject({ motif: 'Quota Claude atteint', cause: 'quota' });
    expect(r.json().blocage.repriseEstimee).not.toBe(null);
    expect(app.depots.quota.lire().epuise).toBe(true);

    await new Promise((res) => setTimeout(res, 50));
    expect(app.service.lire(id).blocage?.cause).toBe('quota');

    await agirSur(app, id, 'relancer');
    const t = await attendre(app, id, (x) => x.urlMaquette !== null);
    expect(t.blocage).toBe(null);
    expect(app.depots.quota.lire().epuise).toBe(false);
  });

  it('#simu:echec-spec bloque en conception et garde la description', async () => {
    const app = creerAppSimulee();
    const id = await nouveauTicket(app, 'Description précieuse #simu:echec-spec');
    await agirSur(app, id, 'lancer-conception');
    const t = await attendre(app, id, (x) => x.blocage !== null);
    expect(t.colonne).toBe('conception');
    expect(t.description).toBe('Description précieuse #simu:echec-spec');
  });

  it('#simu:echec-design bloque en conception, garde la spec et la relance ne refait que le design', async () => {
    const app = creerAppSimulee();
    const id = await nouveauTicket(app, 'Maquette #simu:echec-design');
    await agirSur(app, id, 'lancer-conception');
    const bloque = await attendre(app, id, (x) => x.blocage !== null);
    expect(bloque.colonne).toBe('conception');
    expect(bloque.spec).not.toBe(null);
    expect(bloque.urlMaquette).toBe(null);

    await agirSur(app, id, 'relancer');
    const t = await attendre(app, id, (x) => x.urlMaquette !== null);
    expect(t.specVersion).toBe(1);
    expect(t.design).toContain('# Design');
  });

  it('#simu:echec-preprod bloque en dev, puis la relance ne refait que la préprod', async () => {
    const app = creerAppSimulee();
    const id = await nouveauTicket(app, 'Préprod capricieuse #simu:echec-preprod');
    await agirSur(app, id, 'lancer-conception');
    await attendre(app, id, (x) => x.urlMaquette !== null);
    await agirSur(app, id, 'lancer-dev');
    const bloque = await attendre(app, id, (x) => x.blocage !== null);
    expect(bloque).toMatchObject({ colonne: 'dev', iteration: 3 });
    expect(bloque.blocage?.motif).toContain('préprod');

    await agirSur(app, id, 'relancer');
    const t = await attendre(app, id, (x) => x.colonne === 'test');
    expect(t.iteration).toBe(3);
    expect(t.urlPreprod).toMatch(/^https:\/\/preprod\.exemple\.test\//);
  });

  it('#simu:echec-deploiement bloque en déploiement sans passer en Done', async () => {
    const app = creerAppSimulee();
    const id = await nouveauTicket(app, 'Mise en ligne #simu:echec-deploiement');
    await agirSur(app, id, 'lancer-conception');
    await attendre(app, id, (x) => x.urlMaquette !== null);
    await agirSur(app, id, 'lancer-dev');
    await attendre(app, id, (x) => x.colonne === 'test');
    await agirSur(app, id, 'deployer-prod', { confirmation: true });
    const t = await attendre(app, id, (x) => x.blocage !== null);
    expect(t.colonne).toBe('deploiement');
    expect(t.blocage?.motif).toContain('ne répond pas');

    await agirSur(app, id, 'relancer');
    expect((await attendre(app, id, (x) => x.colonne === 'done')).versionDeployee).toBeTruthy();
  });
});
