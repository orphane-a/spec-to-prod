import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { refusCorrection } from '../../src/domaine/correction-manuelle';
import type { Colonne, Ticket } from '../../src/domaine/types';
import type { MessageFlux } from '../../src/serveur/diffuseur';
import { ErreurMetier } from '../../src/serveur/erreurs';
import { SCENARIOS, TOUT_VERT, agir, creerAppTest, creerTicket, type AppTest } from '../api/outils';

let app: AppTest;

beforeEach(() => {
  app = creerAppTest();
});

afterEach(async () => {
  await app.serveur.close();
});

const URL_MAQUETTE = 'https://github.com/o/r/blob/b/m.html';
const NOUVELLE_URL = 'https://claude.ai/design/maquette-retravaillee';

/** Ticket en conception, spec et design prêts, aucun run en cours. */
async function enConception(): Promise<number> {
  const { id } = await creerTicket(app);
  await agir(app, id, 'lancer-conception');
  await app.service.recevoir(app.claude.dernierRun().id, { type: 'SPEC_PRETE', spec: '# Spec\n\nVersion de départ.' });
  await app.service.recevoir(app.claude.dernierRun().id, { type: 'DESIGN_PRET', resume: '# Écrans\n\nVersion de départ.', urlMaquette: URL_MAQUETTE });
  return id;
}

/** Ticket en dev, run de dev en cours. */
async function enDevAvecRun(): Promise<number> {
  const id = await enConception();
  await agir(app, id, 'lancer-dev');
  return id;
}

/** Ticket en dev, bloqué, sans run. */
async function enDevBloque(): Promise<number> {
  const id = await enDevAvecRun();
  await app.service.recevoir(app.claude.dernierRun().id, { type: 'ECHEC', motif: 'Les tests ne passent pas.' });
  return id;
}

async function enTest(): Promise<number> {
  const id = await enDevAvecRun();
  await app.service.recevoir(app.claude.dernierRun().id, { type: 'DEV_TERMINE', controles: TOUT_VERT, scenarios: SCENARIOS });
  await app.service.recevoir(app.deploiement.dernierRun().id, { type: 'PREPROD_DEPLOYEE', urlPreprod: 'https://preprod.optivie.orphane.fr', version: 'a1b2c3d' });
  return id;
}

async function enDeploiement(): Promise<number> {
  const id = await enTest();
  for (const s of app.service.lire(id).scenarios) app.service.marquerScenario(id, s.id, true);
  await agir(app, id, 'deployer-prod', { confirmation: true });
  return id;
}

async function enDone(): Promise<number> {
  const id = await enDeploiement();
  await app.service.recevoir(app.deploiement.dernierRun().id, { type: 'DEPLOIEMENT_TERMINE', version: 'f00ba12' });
  return id;
}

const journal = (id: number) => app.depots.tickets.journal(id);

describe('règle de permission', () => {
  const cas: [Colonne, Ticket['runEnCours'], string | null][] = [
    ['conception', null, null],
    ['dev', null, null],
    ['backlog', null, 'COLONNE_NON_CORRIGEABLE'],
    ['test', null, 'COLONNE_NON_CORRIGEABLE'],
    ['deploiement', null, 'COLONNE_NON_CORRIGEABLE'],
    ['done', null, 'COLONNE_NON_CORRIGEABLE'],
    ['conception', 'spec', 'RUN_EN_COURS'],
    ['conception', 'design', 'RUN_EN_COURS'],
    ['dev', 'dev', 'RUN_EN_COURS'],
    ['dev', 'preprod', 'RUN_EN_COURS'],
  ];
  it.each(cas)('colonne %s avec run %s : %s', (colonne, runEnCours, code) => {
    expect(refusCorrection({ colonne, runEnCours })?.code ?? null).toBe(code);
  });
});

describe('corriger la spec', () => {
  it('remplace la spec en conception, incrémente la version et journalise', async () => {
    const id = await enConception();
    const avant = app.service.lire(id);
    expect(avant.specVersion).toBe(1);

    const ticket = app.service.corrigerSpec(id, { spec: '# Spec corrigée\n\nÀ la main.' });

    expect(ticket).toMatchObject({ spec: '# Spec corrigée\n\nÀ la main.', specVersion: 2, colonne: 'conception', runEnCours: null });
    expect(app.service.lire(id)).toEqual(ticket);
    expect(journal(id).at(-1)).toMatchObject({ type: 'spec', detail: 'Spec modifiée à la main (version 2).' });
    expect(ticket.modifieLe > avant.modifieLe).toBe(true);
  });

  it('incrémente à chaque correction', async () => {
    const id = await enConception();
    app.service.corrigerSpec(id, { spec: 'Deuxième' });
    const ticket = app.service.corrigerSpec(id, { spec: 'Troisième' });
    expect(ticket.specVersion).toBe(3);
    expect(journal(id).at(-1)?.detail).toBe('Spec modifiée à la main (version 3).');
  });

  it('retire les espaces autour du texte', async () => {
    const id = await enConception();
    expect(app.service.corrigerSpec(id, { spec: '  \n# Titre\n\n' }).spec).toBe('# Titre');
  });

  it('se corrige aussi en dev quand le ticket est bloqué, sans le débloquer ni changer de colonne', async () => {
    const id = await enDevBloque();
    const avant = app.service.lire(id);
    const ticket = app.service.corrigerSpec(id, { spec: 'Spec revue après le blocage' });
    expect(ticket).toMatchObject({ colonne: 'dev', spec: 'Spec revue après le blocage', specVersion: 2, runEnCours: null });
    expect(ticket.blocage).toEqual(avant.blocage);
    expect({ ...ticket, spec: avant.spec, specVersion: avant.specVersion, modifieLe: avant.modifieLe }).toEqual(avant);
  });

  it('ne touche ni au design, ni aux scénarios, ni aux autres champs', async () => {
    const id = await enConception();
    const avant = app.service.lire(id);
    const apres = app.service.corrigerSpec(id, { spec: 'Autre' });
    expect({ ...apres, spec: avant.spec, specVersion: avant.specVersion, modifieLe: avant.modifieLe }).toEqual(avant);
  });

  it('ne lance aucun run', async () => {
    const id = await enConception();
    const lances = app.claude.demandes.length;
    app.service.corrigerSpec(id, { spec: 'Autre' });
    expect(app.claude.demandes).toHaveLength(lances);
    expect(app.deploiement.demandes).toHaveLength(0);
    expect(app.service.lire(id).runEnCours).toBeNull();
  });

  it('diffuse le ticket mis à jour', async () => {
    const id = await enConception();
    const messages: MessageFlux[] = [];
    app.diffuseur.abonner((m) => messages.push(m));
    const ticket = app.service.corrigerSpec(id, { spec: 'Diffusée' });
    expect(messages).toEqual([{ type: 'ticket', ticket }]);
  });

  it.each([
    ['backlog', async () => (await creerTicket(app)).id as number],
    ['test', enTest],
    ['deploiement', enDeploiement],
    ['done', enDone],
  ])('refuse en colonne %s avec un message clair en 409', async (_nom, preparer) => {
    const id = await preparer();
    const avant = app.service.lire(id);
    const nbJournal = journal(id).length;
    const erreur = captureErreur(() => app.service.corrigerSpec(id, { spec: 'Refusée' }));
    expect(erreur).toMatchObject({ statut: 409, code: 'COLONNE_NON_CORRIGEABLE', message: 'La spec et le design se corrigent seulement en conception ou en dev.' });
    expect(app.service.lire(id)).toEqual(avant);
    expect(journal(id)).toHaveLength(nbJournal);
  });

  it('refuse pendant la rédaction de la spec', async () => {
    const { id } = await creerTicket(app);
    await agir(app, id, 'lancer-conception');
    const erreur = captureErreur(() => app.service.corrigerSpec(id, { spec: 'Refusée' }));
    expect(erreur).toMatchObject({ statut: 409, code: 'RUN_EN_COURS', message: 'Un run est en cours, attends sa fin pour corriger la spec ou le design.' });
  });

  it('refuse pendant la conception de la maquette et pendant le dev', async () => {
    const { id } = await creerTicket(app);
    await agir(app, id, 'lancer-conception');
    await app.service.recevoir(app.claude.dernierRun().id, { type: 'SPEC_PRETE', spec: '# Spec' });
    expect(app.service.lire(id).runEnCours).toBe('design');
    expect(captureErreur(() => app.service.corrigerSpec(id, { spec: 'x' }))).toMatchObject({ statut: 409, code: 'RUN_EN_COURS' });

    const dev = await enDevAvecRun();
    expect(captureErreur(() => app.service.corrigerSpec(dev, { spec: 'x' }))).toMatchObject({ statut: 409, code: 'RUN_EN_COURS' });
  });

  it('refuse pendant la préprod, même en dev', async () => {
    const id = await enDevAvecRun();
    await app.service.recevoir(app.claude.dernierRun().id, { type: 'DEV_TERMINE', controles: TOUT_VERT, scenarios: SCENARIOS });
    expect(app.service.lire(id)).toMatchObject({ colonne: 'dev', runEnCours: 'preprod' });
    expect(captureErreur(() => app.service.corrigerSpec(id, { spec: 'x' }))).toMatchObject({ statut: 409, code: 'RUN_EN_COURS' });
  });

  it('renvoie 404 pour un ticket inconnu', () => {
    expect(captureErreur(() => app.service.corrigerSpec(99, { spec: 'x' }))).toMatchObject({ statut: 404 });
  });

  it.each([
    ['vide', { spec: '' }],
    ['des espaces seulement', { spec: '  \n\t ' }],
  ])('refuse une spec %s', async (_nom, corps) => {
    const id = await enConception();
    const avant = app.service.lire(id);
    expect(captureErreur(() => app.service.corrigerSpec(id, corps))).toMatchObject({ statut: 400, message: 'La spec ne peut pas être vide.' });
    expect(app.service.lire(id)).toEqual(avant);
    expect(journal(id).some((e) => e.detail.includes('à la main'))).toBe(false);
  });

  it.each([
    ['absente', {}],
    ['qui n’est pas un texte', { spec: 42 }],
    ['corps absent', undefined],
  ])('refuse une spec %s', async (_nom, corps) => {
    const id = await enConception();
    expect(captureErreur(() => app.service.corrigerSpec(id, corps))).toMatchObject({ statut: 400, code: 'DONNEES_INVALIDES' });
  });

  it('refuse un texte trop long pour la session de dev', async () => {
    const id = await enConception();
    const erreur = captureErreur(() => app.service.corrigerSpec(id, { spec: 'a'.repeat(60_000) }));
    expect(erreur).toMatchObject({ statut: 400, message: 'La spec et le design réunis sont trop longs pour la session de dev. Raccourcis le texte.' });
  });
});

describe('corriger le design', () => {
  it('remplace le résumé et le lien, incrémente la version et journalise', async () => {
    const id = await enConception();
    const ticket = app.service.corrigerDesign(id, { design: '# Écrans retravaillés', urlMaquette: NOUVELLE_URL });
    expect(ticket).toMatchObject({ design: '# Écrans retravaillés', urlMaquette: NOUVELLE_URL, designVersion: 2, colonne: 'conception', runEnCours: null });
    expect(app.service.lire(id)).toEqual(ticket);
    expect(journal(id).at(-1)).toMatchObject({ type: 'design', detail: 'Design modifié à la main (version 2).' });
  });

  it('incrémente à chaque correction', async () => {
    const id = await enConception();
    app.service.corrigerDesign(id, { design: 'Deuxième', urlMaquette: NOUVELLE_URL });
    expect(app.service.corrigerDesign(id, { design: 'Troisième', urlMaquette: NOUVELLE_URL }).designVersion).toBe(3);
    expect(journal(id).at(-1)?.detail).toBe('Design modifié à la main (version 3).');
  });

  it('crée une première version à la main quand le ticket n’a pas de design', async () => {
    const { id } = await creerTicket(app);
    await agir(app, id, 'lancer-conception');
    await app.service.recevoir(app.claude.dernierRun().id, { type: 'ECHEC', motif: 'La conception a échoué' });
    expect(app.service.lire(id)).toMatchObject({ design: null, designVersion: 0, runEnCours: null });
    const ticket = app.service.corrigerDesign(id, { design: '# Fait à la main', urlMaquette: NOUVELLE_URL });
    expect(ticket).toMatchObject({ designVersion: 1, design: '# Fait à la main' });
    expect(journal(id).at(-1)?.detail).toBe('Design modifié à la main (version 1).');
  });

  it('se corrige en dev quand le ticket est bloqué, sans changer de colonne', async () => {
    const id = await enDevBloque();
    const ticket = app.service.corrigerDesign(id, { design: 'Revu', urlMaquette: NOUVELLE_URL });
    expect(ticket).toMatchObject({ colonne: 'dev', designVersion: 2, runEnCours: null });
    expect(ticket.blocage).not.toBeNull();
  });

  it('ne touche ni à la spec ni aux autres champs', async () => {
    const id = await enConception();
    const avant = app.service.lire(id);
    const apres = app.service.corrigerDesign(id, { design: 'Autre', urlMaquette: NOUVELLE_URL });
    expect({ ...apres, design: avant.design, urlMaquette: avant.urlMaquette, designVersion: avant.designVersion, modifieLe: avant.modifieLe }).toEqual(avant);
  });

  it('diffuse le ticket mis à jour', async () => {
    const id = await enConception();
    const messages: MessageFlux[] = [];
    app.diffuseur.abonner((m) => messages.push(m));
    const ticket = app.service.corrigerDesign(id, { design: 'Diffusé', urlMaquette: NOUVELLE_URL });
    expect(messages).toEqual([{ type: 'ticket', ticket }]);
  });

  it.each([
    ['backlog', async () => (await creerTicket(app)).id as number],
    ['test', enTest],
    ['deploiement', enDeploiement],
    ['done', enDone],
  ])('refuse en colonne %s en 409', async (_nom, preparer) => {
    const id = await preparer();
    const avant = app.service.lire(id);
    const erreur = captureErreur(() => app.service.corrigerDesign(id, { design: 'Refusé', urlMaquette: NOUVELLE_URL }));
    expect(erreur).toMatchObject({ statut: 409, code: 'COLONNE_NON_CORRIGEABLE' });
    expect(app.service.lire(id)).toEqual(avant);
  });

  it('refuse avec un run en cours', async () => {
    const id = await enDevAvecRun();
    expect(captureErreur(() => app.service.corrigerDesign(id, { design: 'x', urlMaquette: NOUVELLE_URL }))).toMatchObject({ statut: 409, code: 'RUN_EN_COURS' });
  });

  it.each([
    ['un résumé vide', { design: '  ', urlMaquette: NOUVELLE_URL }, 'Le résumé du design ne peut pas être vide.'],
    ['un lien absent', { design: 'x' }, 'Le lien de la maquette est obligatoire.'],
    ['un lien vide', { design: 'x', urlMaquette: '' }, 'Le lien de la maquette doit être une adresse https valide.'],
    ['un lien en http', { design: 'x', urlMaquette: 'http://exemple.fr/m.html' }, 'Le lien de la maquette doit être une adresse https valide.'],
    ['un lien sans protocole', { design: 'x', urlMaquette: 'exemple.fr/m.html' }, 'Le lien de la maquette doit être une adresse https valide.'],
    ['un lien javascript', { design: 'x', urlMaquette: 'javascript:alert(1)' }, 'Le lien de la maquette doit être une adresse https valide.'],
    ['un lien sans domaine', { design: 'x', urlMaquette: 'https://' }, 'Le lien de la maquette doit être une adresse https valide.'],
  ])('refuse %s', async (_nom, corps, message) => {
    const id = await enConception();
    const avant = app.service.lire(id);
    expect(captureErreur(() => app.service.corrigerDesign(id, corps))).toMatchObject({ statut: 400, message });
    expect(app.service.lire(id)).toEqual(avant);
  });

  it('refuse un texte trop long pour la session de dev', async () => {
    const id = await enConception();
    const erreur = captureErreur(() => app.service.corrigerDesign(id, { design: 'a'.repeat(60_000), urlMaquette: NOUVELLE_URL }));
    expect(erreur).toMatchObject({ statut: 400, message: 'La spec et le design réunis sont trop longs pour la session de dev. Raccourcis le texte.' });
  });
});

describe('la session suivante reçoit les textes corrigés', () => {
  it('Lancer le dev envoie la spec et le design modifiés', async () => {
    const id = await enConception();
    app.service.corrigerSpec(id, { spec: '# Spec finale' });
    app.service.corrigerDesign(id, { design: '# Design final', urlMaquette: NOUVELLE_URL });
    await agir(app, id, 'lancer-dev');
    const demande = app.claude.demandes.at(-1)!;
    expect(demande.run.type).toBe('dev');
    expect(demande.ticket).toMatchObject({ spec: '# Spec finale', design: '# Design final', urlMaquette: NOUVELLE_URL });
  });

  it('Relancer un ticket bloqué en dev envoie la spec et le design modifiés', async () => {
    const id = await enDevBloque();
    app.service.corrigerSpec(id, { spec: '# Spec revue' });
    app.service.corrigerDesign(id, { design: '# Design revu', urlMaquette: NOUVELLE_URL });
    await agir(app, id, 'relancer');
    const demande = app.claude.demandes.at(-1)!;
    expect(demande.run.type).toBe('dev');
    expect(demande.ticket).toMatchObject({ spec: '# Spec revue', design: '# Design revu', urlMaquette: NOUVELLE_URL, colonne: 'dev' });
  });
});

function captureErreur(fonction: () => unknown): ErreurMetier {
  try {
    fonction();
  } catch (erreur) {
    expect(erreur).toBeInstanceOf(ErreurMetier);
    return erreur as ErreurMetier;
  }
  throw new Error('Une erreur était attendue.');
}
