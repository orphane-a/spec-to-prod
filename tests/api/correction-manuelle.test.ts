import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { creerApp } from '../../src/serveur/app';
import { ExecuteurEspion, SECRET_TEST, TOUT_VERT, SCENARIOS, agir, creerAppTest, creerTicket, type AppTest } from './outils';

let app: AppTest;

beforeEach(() => {
  app = creerAppTest();
});

afterEach(async () => {
  await app.serveur.close();
});

const URL_MAQUETTE = 'https://github.com/o/r/blob/b/m.html';
const NOUVELLE_URL = 'https://claude.ai/design/maquette-retravaillee';

async function enConception(): Promise<number> {
  const { id } = await creerTicket(app);
  await agir(app, id, 'lancer-conception');
  await app.service.recevoir(app.claude.dernierRun().id, { type: 'SPEC_PRETE', spec: '# Spec\n\nDépart.' });
  await app.service.recevoir(app.claude.dernierRun().id, { type: 'DESIGN_PRET', resume: '# Écrans\n\nDépart.', urlMaquette: URL_MAQUETTE });
  return id;
}

const patcherSpec = (id: number | string, payload?: unknown) => app.serveur.inject({ method: 'PATCH', url: `/api/tickets/${id}/spec`, payload: payload as object });
const patcherDesign = (id: number | string, payload?: unknown) => app.serveur.inject({ method: 'PATCH', url: `/api/tickets/${id}/design`, payload: payload as object });

describe('PATCH /api/tickets/:id/spec', () => {
  it('corrige la spec sans changer de colonne et renvoie le ticket', async () => {
    const id = await enConception();
    const r = await patcherSpec(id, { spec: '# Spec corrigée' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ id, spec: '# Spec corrigée', specVersion: 2, colonne: 'conception', runEnCours: null });
    expect((await app.serveur.inject(`/api/tickets/${id}`)).json()).toEqual(r.json());
  });

  it('ajoute l’entrée au journal', async () => {
    const id = await enConception();
    await patcherSpec(id, { spec: 'Autre' });
    const journal = (await app.serveur.inject(`/api/tickets/${id}/journal`)).json();
    expect(journal.at(-1)).toMatchObject({ type: 'spec', detail: 'Spec modifiée à la main (version 2).' });
  });

  it('refuse hors conception et dev, en 409 avec un message en français', async () => {
    const { id } = await creerTicket(app);
    const r = await patcherSpec(id, { spec: 'Refusée' });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toEqual({ code: 'COLONNE_NON_CORRIGEABLE', message: 'La spec et le design se corrigent seulement en conception ou en dev.' });
  });

  it('refuse en test, la spec reste intacte', async () => {
    const id = await enConception();
    await agir(app, id, 'lancer-dev');
    await app.service.recevoir(app.claude.dernierRun().id, { type: 'DEV_TERMINE', controles: TOUT_VERT, scenarios: SCENARIOS });
    await app.service.recevoir(app.deploiement.dernierRun().id, { type: 'PREPROD_DEPLOYEE', urlPreprod: 'https://preprod.optivie.orphane.fr', version: 'a1b2c3d' });
    const avant = (await app.serveur.inject(`/api/tickets/${id}`)).json();
    expect(avant.colonne).toBe('test');
    expect((await patcherSpec(id, { spec: 'Refusée' })).statusCode).toBe(409);
    expect((await app.serveur.inject(`/api/tickets/${id}`)).json()).toEqual(avant);
  });

  it('refuse pendant un run, en 409', async () => {
    const { id } = await creerTicket(app);
    await agir(app, id, 'lancer-conception');
    const r = await patcherSpec(id, { spec: 'Refusée' });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toEqual({ code: 'RUN_EN_COURS', message: 'Un run est en cours, attends sa fin pour corriger la spec ou le design.' });
  });

  it('refuse une spec vide en 400', async () => {
    const id = await enConception();
    const r = await patcherSpec(id, { spec: '   ' });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toEqual({ code: 'DONNEES_INVALIDES', message: 'La spec ne peut pas être vide.' });
  });

  it('refuse un corps absent ou sans spec en 400', async () => {
    const id = await enConception();
    expect((await patcherSpec(id)).statusCode).toBe(400);
    expect((await patcherSpec(id, {})).statusCode).toBe(400);
    expect((await patcherSpec(id, { spec: 12 })).statusCode).toBe(400);
  });

  it('refuse un texte trop long en 400', async () => {
    const id = await enConception();
    const r = await patcherSpec(id, { spec: 'a'.repeat(60_000) });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe('TEXTE_TROP_LONG');
  });

  it('renvoie 404 pour un ticket inconnu et 400 pour un identifiant invalide', async () => {
    expect((await patcherSpec(99, { spec: 'x' })).statusCode).toBe(404);
    expect((await patcherSpec('abc', { spec: 'x' })).statusCode).toBe(400);
  });
});

describe('PATCH /api/tickets/:id/design', () => {
  it('corrige le design et le lien sans changer de colonne', async () => {
    const id = await enConception();
    const r = await patcherDesign(id, { design: '# Écrans retravaillés', urlMaquette: NOUVELLE_URL });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ id, design: '# Écrans retravaillés', urlMaquette: NOUVELLE_URL, designVersion: 2, colonne: 'conception' });
    expect((await app.serveur.inject(`/api/tickets/${id}`)).json()).toEqual(r.json());
  });

  it('ajoute l’entrée au journal', async () => {
    const id = await enConception();
    await patcherDesign(id, { design: 'Autre', urlMaquette: NOUVELLE_URL });
    const journal = (await app.serveur.inject(`/api/tickets/${id}/journal`)).json();
    expect(journal.at(-1)).toMatchObject({ type: 'design', detail: 'Design modifié à la main (version 2).' });
  });

  it('corrige en dev quand le ticket est bloqué', async () => {
    const id = await enConception();
    await agir(app, id, 'lancer-dev');
    await app.service.recevoir(app.claude.dernierRun().id, { type: 'ECHEC', motif: 'Les tests ne passent pas.' });
    const r = await patcherDesign(id, { design: 'Revu', urlMaquette: NOUVELLE_URL });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ colonne: 'dev', designVersion: 2 });
    expect(r.json().blocage).not.toBeNull();
  });

  it('refuse hors conception et dev, en 409', async () => {
    const { id } = await creerTicket(app);
    const r = await patcherDesign(id, { design: 'Refusé', urlMaquette: NOUVELLE_URL });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe('COLONNE_NON_CORRIGEABLE');
  });

  it('refuse pendant un run, en 409', async () => {
    const id = await enConception();
    await agir(app, id, 'lancer-dev');
    const r = await patcherDesign(id, { design: 'Refusé', urlMaquette: NOUVELLE_URL });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe('RUN_EN_COURS');
  });

  it.each([
    ['résumé vide', { design: '', urlMaquette: NOUVELLE_URL }, 'Le résumé du design ne peut pas être vide.'],
    ['lien absent', { design: 'x' }, 'Le lien de la maquette est obligatoire.'],
    ['lien en http', { design: 'x', urlMaquette: 'http://exemple.fr/m.html' }, 'Le lien de la maquette doit être une adresse https valide.'],
    ['lien invalide', { design: 'x', urlMaquette: 'pas un lien' }, 'Le lien de la maquette doit être une adresse https valide.'],
  ])('refuse %s en 400', async (_nom, corps, message) => {
    const id = await enConception();
    const avant = (await app.serveur.inject(`/api/tickets/${id}`)).json();
    const r = await patcherDesign(id, corps);
    expect(r.statusCode).toBe(400);
    expect(r.json()).toEqual({ code: 'DONNEES_INVALIDES', message });
    expect((await app.serveur.inject(`/api/tickets/${id}`)).json()).toEqual(avant);
  });

  it('refuse un corps absent en 400 et un ticket inconnu en 404', async () => {
    const id = await enConception();
    expect((await patcherDesign(id)).statusCode).toBe(400);
    expect((await patcherDesign(99, { design: 'x', urlMaquette: NOUVELLE_URL })).statusCode).toBe(404);
  });
});

describe('accès protégé comme les autres routes', () => {
  it('refuse les deux routes sans session quand un mot de passe est défini', async () => {
    const protegee = creerApp({
      config: { BASE_CHEMIN: ':memory:', ITERATIONS_MAX: 5, WEBHOOK_SECRET: SECRET_TEST, MOT_DE_PASSE: 'un-mot-de-passe-solide' },
      executeurs: { claude: new ExecuteurEspion(), deploiement: new ExecuteurEspion() },
    });
    try {
      const spec = await protegee.serveur.inject({ method: 'PATCH', url: '/api/tickets/1/spec', payload: { spec: 'x' } });
      const design = await protegee.serveur.inject({ method: 'PATCH', url: '/api/tickets/1/design', payload: { design: 'x', urlMaquette: NOUVELLE_URL } });
      expect(spec.statusCode).toBe(401);
      expect(design.statusCode).toBe(401);
      expect(spec.json().code).toBe('NON_CONNECTE');
    } finally {
      await protegee.serveur.close();
    }
  });
});
