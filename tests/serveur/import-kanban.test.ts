import { describe, expect, it } from 'vitest';
import { ouvrirBase } from '../../src/serveur/base/connexion';
import { creerDepots } from '../../src/serveur/base/depots';
import { convertirCarte } from '../../src/serveur/import/kanban-artefact';

const carteOptivie = {
  id: 'OPT-015',
  titre: 'Lot 3 · Proposer une tournée optimisée',
  status: 'done',
  epic: 'Optimiser les tournées',
  specSummary: 'Proposer une tournée qui réduit les km non payés.',
  acceptance: ['Les km baissent'],
  specLink: 'https://claude.ai/artifact/x',
  prUrl: 'https://github.com/orphane-a/optivie/pull/2',
  branch: 'feature/OPT-015',
  iteration: 0,
  testScenarios: [{ titre: 'Optimiser une semaine', prerequis: 'Base de démo', etapes: ['Ouvrir', 'Optimiser'], attendu: 'Les km baissent', casLimites: ['Semaine vide'] }],
  history: [
    { at: '2026-10-30T10:00:00Z', transition: 'création', result: 'carte créée', kind: 'info' },
    { at: '2026-10-31T10:00:00Z', transition: 'test_anne -> deploy', result: 'demandé par Anne', link: 'https://exemple' },
  ],
  updatedAt: '2026-11-01T10:00:00Z',
};

const carteElections = {
  id: 'r02',
  titre: 'Retirer la légende des pastilles',
  status: 'testia',
  priority: 'P1',
  ref: "Retour d'Anne du 17 novembre",
  specSummary: 'Supprimer la phrase.',
  criteres: ['La phrase n’apparaît plus'],
  branch: 'feature/r02',
  iteration: 1,
  testScenarios: ['Prérequis : préprod. Étapes : 1. Ouvrir l’accueil.'],
  history: [{ date: '2026-11-17T06:30:00.000Z', transition: 'Création vers Backlog', resultat: 'Carte créée', lien: '' }],
  updatedAt: '2026-11-17T13:10:00.000Z',
};

describe('import des anciens kanbans', () => {
  it('convertit une carte Optivie livrée', () => {
    const t = convertirCarte(carteOptivie, 'Optivie', null)!;
    expect(t).toMatchObject({
      titre: 'Proposer une tournée optimisée',
      colonne: 'done',
      branche: 'feature/OPT-015',
      deployeLe: '2026-11-01T10:00:00.000Z',
      creeLe: '2026-10-30T10:00:00.000Z',
      controles: { unitaires: 'vert', non_regression: 'vert', exploratoire: 'vert' },
    });
    expect(t.description).toContain('- Les km baissent');
    expect(t.description).toContain('Carte OPT-015 du kanban Optivie, epic Optimiser les tournées.');
    expect(t.scenarios[0]).toMatchObject({ objectif: 'Optimiser une semaine', resultatAttendu: 'Les km baissent' });
    expect(t.scenarios[0]!.etapes).toContain('1. Ouvrir');
    expect(t.journal.at(-1)!.detail).toBe('Ticket importé depuis le kanban Optivie (carte OPT-015).');
  });

  it('place une carte En test IA dans En test avec l’URL de préprod du projet', () => {
    const t = convertirCarte(carteElections, 'Elections 2027', 'https://preprod.demandez-le-programme.fr')!;
    expect(t).toMatchObject({ colonne: 'test', iteration: 1, urlPreprod: 'https://preprod.demandez-le-programme.fr', deployeLe: null });
    expect(t.scenarios).toHaveLength(1);
    expect(t.description).toContain('priorité P1');
  });

  it('ignore les cartes supprimées et les colonnes inconnues', () => {
    expect(convertirCarte({ ...carteElections, deleted: true }, 'x', null)).toBeNull();
    expect(convertirCarte({ ...carteElections, status: 'blocked' }, 'x', null)).toBeNull();
  });

  it('garde une carte du backlog sans spec ni branche principale', () => {
    const t = convertirCarte({ ...carteOptivie, status: 'backlog', branch: 'master', testScenarios: [] }, 'Optivie', null)!;
    expect(t).toMatchObject({ colonne: 'backlog', spec: null, branche: null, deployeLe: null });
    expect(t.controles.unitaires).toBe('en_attente');
  });

  it('enregistre le ticket importé avec son journal et ses scénarios', () => {
    const base = ouvrirBase(':memory:');
    const depots = creerDepots(base, 5);
    const projet = depots.projets.parNom('Optivie')!;
    expect(depots.projets.parNom('AMLF')).toBeNull();
    const ticket = depots.tickets.importer(projet.id, convertirCarte(carteOptivie, 'Optivie', projet.urlPreprod)!);
    expect(ticket).toMatchObject({ projetId: projet.id, colonne: 'done', specVersion: 1 });
    expect(ticket.scenarios[0]!.fait).toBe(true);
    expect(depots.tickets.journal(ticket.id).map((e) => e.date)).toEqual([
      '2026-10-30T10:00:00.000Z',
      '2026-10-31T10:00:00.000Z',
      '2026-11-01T10:00:00.000Z',
    ]);
    expect(depots.tickets.existeDansProjet(projet.id, ticket.titre)).toBe(true);
  });
});
