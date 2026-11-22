import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SCENARIOS, TOUT_VERT, agir, creerAppTest, creerTicket, type AppTest } from './outils';

let app: AppTest;

beforeEach(() => {
  app = creerAppTest();
});

afterEach(async () => {
  await app.serveur.close();
});

const commenter = (id: number | string, payload?: unknown) =>
  app.serveur.inject({ method: 'POST', url: `/api/tickets/${id}/commentaires`, payload: payload as object });
const retirer = (id: number | string, commentaireId: number | string) =>
  app.serveur.inject({ method: 'DELETE', url: `/api/tickets/${id}/commentaires/${commentaireId}` });
const lire = async (id: number) => (await app.serveur.inject(`/api/tickets/${id}`)).json();
const journal = async (id: number) => (await app.serveur.inject(`/api/tickets/${id}/journal`)).json();

async function specPrete(): Promise<number> {
  const { id } = await creerTicket(app);
  await agir(app, id, 'lancer-conception');
  await app.service.recevoir(app.claude.dernierRun().id, { type: 'SPEC_PRETE', spec: '# Spec' });
  // La spec prête lance seule le design : on le termine pour revenir à un ticket sans run.
  await app.service.recevoir(app.claude.dernierRun().id, { type: 'DESIGN_PRET', resume: '# Design', urlMaquette: 'https://github.com/o/r/blob/b/m.html' });
  return id;
}

describe('POST /api/tickets/:id/commentaires', () => {
  it('ajoute un commentaire au ticket sans changer de colonne', async () => {
    const { id } = await creerTicket(app);
    const r = await commenter(id, { sujet: 'spec', texte: '  Préciser le cas des absences.  ' });
    expect(r.statusCode).toBe(201);
    const ticket = r.json();
    expect(ticket).toMatchObject({ id, colonne: 'backlog', runEnCours: null });
    expect(ticket.commentaires).toEqual([
      { id: expect.any(Number), sujet: 'spec', texte: 'Préciser le cas des absences.', creeLe: expect.any(String), prisEnCompteLe: null },
    ]);
    expect(await lire(id)).toEqual(ticket);
  });

  it('écrit une entrée de journal selon le sujet', async () => {
    const { id } = await creerTicket(app);
    await commenter(id, { sujet: 'design', texte: 'Bouton trop petit.' });
    await commenter(id, { sujet: 'general', texte: 'Penser au mobile.' });
    await commenter(id, { sujet: 'tests', texte: 'Le cas d’erreur ne marche pas.' });
    await commenter(id, { sujet: 'spec', texte: 'Ajouter un filtre.' });
    const details = (await journal(id)).slice(-4).map((e: { detail: string }) => e.detail);
    expect(details).toEqual([
      'Commentaire ajouté sur le design.',
      'Commentaire ajouté.',
      'Commentaire ajouté sur les tests.',
      'Commentaire ajouté sur la spec.',
    ]);
  });

  it('accepte un commentaire pendant un run et sur un ticket en test', async () => {
    const { id } = await creerTicket(app);
    await agir(app, id, 'lancer-conception');
    expect((await commenter(id, { sujet: 'spec', texte: 'Pendant la rédaction.' })).statusCode).toBe(201);

    const id2 = await specPrete();
    await agir(app, id2, 'lancer-dev');
    await app.service.recevoir(app.claude.dernierRun().id, { type: 'DEV_TERMINE', controles: TOUT_VERT, scenarios: SCENARIOS });
    await app.service.recevoir(app.deploiement.dernierRun().id, { type: 'PREPROD_DEPLOYEE', urlPreprod: 'https://preprod.exemple.fr', version: 'a1b2c3d' });
    expect((await lire(id2)).colonne).toBe('test');
    expect((await commenter(id2, { sujet: 'tests', texte: 'Le scénario 2 échoue.' })).statusCode).toBe(201);
  });

  it('refuse un texte vide en 400 avec un message en français', async () => {
    const { id } = await creerTicket(app);
    const r = await commenter(id, { sujet: 'spec', texte: '   ' });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toEqual({ code: 'DONNEES_INVALIDES', message: 'Le commentaire ne peut pas être vide.' });
  });

  it('refuse un texte trop long en 400', async () => {
    const { id } = await creerTicket(app);
    const r = await commenter(id, { sujet: 'spec', texte: 'a'.repeat(5001) });
    expect(r.statusCode).toBe(400);
    expect(r.json().message).toBe('Le commentaire fait 5 000 caractères au plus.');
  });

  it('refuse un sujet inconnu ou un corps absent en 400', async () => {
    const { id } = await creerTicket(app);
    expect((await commenter(id, { sujet: 'prod', texte: 'Non.' })).json()).toEqual({ code: 'DONNEES_INVALIDES', message: 'Choisis le sujet du commentaire.' });
    expect((await commenter(id)).statusCode).toBe(400);
  });

  it('répond 404 pour un ticket inconnu', async () => {
    expect((await commenter(999, { sujet: 'spec', texte: 'Perdu.' })).statusCode).toBe(404);
  });

  it('refuse des commentaires en attente trop longs pour la session', async () => {
    const { id } = await creerTicket(app);
    // Environ 45 000 caractères sont réservés à la spec, au design et aux commentaires en attente.
    for (let i = 0; i < 8; i++) expect((await commenter(id, { sujet: 'general', texte: 'a'.repeat(5000) })).statusCode).toBe(201);
    const r = await commenter(id, { sujet: 'general', texte: 'a'.repeat(5000) });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe('TEXTE_TROP_LONG');
  });
});

describe('DELETE /api/tickets/:id/commentaires/:commentaireId', () => {
  it('supprime un commentaire pas encore transmis et le note au journal', async () => {
    const { id } = await creerTicket(app);
    const { commentaires } = (await commenter(id, { sujet: 'spec', texte: 'À retirer.' })).json();
    const r = await retirer(id, commentaires[0].id);
    expect(r.statusCode).toBe(200);
    expect(r.json().commentaires).toEqual([]);
    expect((await journal(id)).at(-1)).toMatchObject({ type: 'commentaire', detail: 'Commentaire supprimé.' });
  });

  it('refuse de supprimer un commentaire déjà transmis à Claude, en 409', async () => {
    const { id } = await creerTicket(app);
    const { commentaires } = (await commenter(id, { sujet: 'spec', texte: 'Pour la spec.' })).json();
    await agir(app, id, 'lancer-conception');
    const r = await retirer(id, commentaires[0].id);
    expect(r.statusCode).toBe(409);
    expect(r.json()).toEqual({ code: 'COMMENTAIRE_TRANSMIS', message: 'Ce commentaire a déjà été transmis à Claude, il ne se supprime plus.' });
  });

  it('répond 404 pour un commentaire d’un autre ticket', async () => {
    const { id } = await creerTicket(app);
    const { id: autre } = await creerTicket(app);
    const { commentaires } = (await commenter(autre, { sujet: 'spec', texte: 'Ailleurs.' })).json();
    expect((await retirer(id, commentaires[0].id)).statusCode).toBe(404);
  });
});

describe('Transmission des commentaires à Claude', () => {
  it('la spec reçoit les commentaires généraux et ceux sur la spec, puis ils sont pris en compte', async () => {
    const { id } = await creerTicket(app);
    await commenter(id, { sujet: 'general', texte: 'Général.' });
    await commenter(id, { sujet: 'spec', texte: 'Spec.' });
    await commenter(id, { sujet: 'design', texte: 'Design.' });
    await commenter(id, { sujet: 'tests', texte: 'Tests.' });
    await agir(app, id, 'lancer-conception');

    const ticket = await lire(id);
    const pris = ticket.commentaires.filter((c: { prisEnCompteLe: string | null }) => c.prisEnCompteLe).map((c: { texte: string }) => c.texte);
    expect(pris).toEqual(['Général.', 'Spec.']);
    expect((await journal(id)).map((e: { detail: string }) => e.detail)).toContain('2 commentaires transmis à Claude.');
  });

  it('le design reçoit ceux sur le design, le dev reçoit le reste', async () => {
    const { id } = await creerTicket(app);
    await agir(app, id, 'lancer-conception');
    await commenter(id, { sujet: 'design', texte: 'Design.' });
    await commenter(id, { sujet: 'tests', texte: 'Tests.' });
    await app.service.recevoir(app.claude.dernierRun().id, { type: 'SPEC_PRETE', spec: '# Spec' });
    expect((await lire(id)).commentaires.map((c: { prisEnCompteLe: string | null }) => c.prisEnCompteLe !== null)).toEqual([true, false]);
    await app.service.recevoir(app.claude.dernierRun().id, { type: 'DESIGN_PRET', resume: '# Design', urlMaquette: 'https://github.com/o/r/blob/b/m.html' });
    await agir(app, id, 'lancer-dev');
    expect((await lire(id)).commentaires.every((c: { prisEnCompteLe: string | null }) => c.prisEnCompteLe !== null)).toBe(true);
    expect((await journal(id)).map((e: { detail: string }) => e.detail)).toContain('1 commentaire transmis à Claude.');
  });

  it('un commentaire n’est transmis qu’une fois', async () => {
    const id = await specPrete();
    // Un retour sur les tests ne relance pas la conception : il attend le dev.
    await commenter(id, { sujet: 'tests', texte: 'Une fois.' });
    await agir(app, id, 'lancer-dev');
    await app.service.recevoir(app.claude.dernierRun().id, { type: 'ECHEC', motif: 'Raté.' });
    await agir(app, id, 'relancer');
    const transmissions = (await journal(id)).filter((e: { detail: string }) => e.detail.endsWith('transmis à Claude.'));
    expect(transmissions).toHaveLength(1);
  });

  it('un lancement raté laisse les commentaires en attente', async () => {
    const { id } = await creerTicket(app);
    await commenter(id, { sujet: 'spec', texte: 'À garder.' });
    app.claude.comportement = async () => {
      throw new Error('panne');
    };
    await agir(app, id, 'lancer-conception');
    const ticket = await lire(id);
    expect(ticket.blocage).not.toBeNull();
    expect(ticket.commentaires[0].prisEnCompteLe).toBeNull();
  });

  it('l’exécuteur reçoit le ticket avec ses commentaires', async () => {
    const { id } = await creerTicket(app);
    await commenter(id, { sujet: 'spec', texte: 'Visible par Claude.' });
    await agir(app, id, 'lancer-conception');
    expect(app.claude.demandes.at(-1)!.ticket.commentaires.map((c) => c.texte)).toEqual(['Visible par Claude.']);
  });
});

const runs = () => app.claude.demandes.map((d) => d.run.type);
const details = async (id: number) => (await journal(id)).map((e: { detail: string }) => e.detail);

describe('Relance automatique en conception', () => {
  it('un commentaire sur la spec relance la spec aussitôt, puis le design suit', async () => {
    const id = await specPrete();
    const r = await commenter(id, { sujet: 'spec', texte: 'Ajouter les absences.' });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ colonne: 'conception', runEnCours: 'spec' });
    expect(r.json().commentaires[0].prisEnCompteLe).not.toBeNull();
    expect(runs()).toEqual(['spec', 'design', 'spec']);
    expect(app.claude.demandes.at(-1)!.ticket.commentaires.map((c) => c.texte)).toEqual(['Ajouter les absences.']);
    expect(await details(id)).toContain('Claude retravaille la spec avec vos commentaires.');

    await app.service.recevoir(app.claude.dernierRun().id, { type: 'SPEC_PRETE', spec: '# Spec v2' });
    expect(await lire(id)).toMatchObject({ spec: '# Spec v2', specVersion: 2, runEnCours: 'design' });
  });

  it('un commentaire général relance aussi la spec', async () => {
    const id = await specPrete();
    await commenter(id, { sujet: 'general', texte: 'Penser au mobile.' });
    expect(runs().at(-1)).toBe('spec');
  });

  it('un commentaire sur le design relance seulement le design', async () => {
    const id = await specPrete();
    const r = await commenter(id, { sujet: 'design', texte: 'Bouton plus grand.' });
    expect(r.json()).toMatchObject({ runEnCours: 'design', spec: '# Spec' });
    expect(runs()).toEqual(['spec', 'design', 'design']);
    expect(await details(id)).toContain('Claude retravaille le design avec vos commentaires.');
  });

  it('un commentaire sur les tests ne relance rien', async () => {
    const id = await specPrete();
    const r = await commenter(id, { sujet: 'tests', texte: 'Tester sur mobile.' });
    expect(r.json().runEnCours).toBeNull();
    expect(r.json().commentaires[0].prisEnCompteLe).toBeNull();
    expect(runs()).toEqual(['spec', 'design']);
  });

  it('pendant un run, le commentaire attend sa fin puis relance l’étape', async () => {
    const { id } = await creerTicket(app);
    await agir(app, id, 'lancer-conception');
    await commenter(id, { sujet: 'spec', texte: 'Écrit pendant la rédaction.' });
    expect(runs()).toEqual(['spec']);

    await app.service.recevoir(app.claude.dernierRun().id, { type: 'SPEC_PRETE', spec: '# Spec' });
    // Le design ne consomme pas un retour sur la spec : il reste en attente.
    expect(app.claude.demandes.at(-1)!.ticket.commentaires).toHaveLength(1);
    expect(runs()).toEqual(['spec', 'design']);
    expect((await lire(id)).commentaires[0].prisEnCompteLe).toBeNull();

    await app.service.recevoir(app.claude.dernierRun().id, { type: 'DESIGN_PRET', resume: '# Design', urlMaquette: 'https://github.com/o/r/blob/b/m.html' });
    expect(runs()).toEqual(['spec', 'design', 'spec']);
    expect((await lire(id)).commentaires[0].prisEnCompteLe).not.toBeNull();
  });

  it('un ticket bloqué ne repart pas : le commentaire attend Relancer', async () => {
    const { id } = await creerTicket(app);
    await agir(app, id, 'lancer-conception');
    await app.service.recevoir(app.claude.dernierRun().id, { type: 'QUOTA_ATTEINT', repriseEstimee: null });
    const r = await commenter(id, { sujet: 'spec', texte: 'Attendra.' });
    expect(r.json().blocage).not.toBeNull();
    expect(r.json().commentaires[0].prisEnCompteLe).toBeNull();
    expect(runs()).toEqual(['spec']);

    await agir(app, id, 'relancer');
    expect((await lire(id)).commentaires[0].prisEnCompteLe).not.toBeNull();
  });

  it('dans le backlog, le commentaire attend le lancement de la conception', async () => {
    const { id } = await creerTicket(app);
    const r = await commenter(id, { sujet: 'spec', texte: 'Pour plus tard.' });
    expect(r.json()).toMatchObject({ colonne: 'backlog', runEnCours: null });
    expect(runs()).toEqual([]);
  });

  it('si la relance échoue, le commentaire est enregistré et reste en attente', async () => {
    const id = await specPrete();
    app.claude.comportement = async () => {
      throw new Error('panne');
    };
    const r = await commenter(id, { sujet: 'spec', texte: 'Gardé.' });
    expect(r.statusCode).toBe(201);
    expect(r.json().blocage).not.toBeNull();
    expect(r.json().commentaires[0]).toMatchObject({ texte: 'Gardé.', prisEnCompteLe: null });
  });
});
