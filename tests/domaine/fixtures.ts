import { CONTROLES_INITIAUX, ETAPES_INITIALES } from '../../src/domaine/colonnes';
import type { ControlesDev, Evenement, Ticket, TypeEvenement } from '../../src/domaine/types';

export const MAINTENANT = '2026-11-17T10:00:00.000Z';
export const CTX = { maintenant: MAINTENANT };

export const TOUT_VERT: ControlesDev = { unitaires: 'vert', non_regression: 'vert', exploratoire: 'vert' };

export function ticket(partiel: Partial<Ticket> = {}): Ticket {
  return {
    id: 12,
    titre: 'Fiche personnage',
    description: 'Une fiche par joueur.',
    projetId: 1,
    colonne: 'backlog',
    blocage: null,
    runEnCours: null,
    spec: null,
    specVersion: 0,
    branche: null,
    iteration: 0,
    iterationMax: 5,
    controles: { ...CONTROLES_INITIAUX },
    etapesDeploiement: { ...ETAPES_INITIALES },
    scenarios: [],
    urlPreprod: null,
    versionDeployee: null,
    deployeLe: null,
    creeLe: '2026-11-01T08:00:00.000Z',
    modifieLe: '2026-11-01T08:00:00.000Z',
    ...partiel,
  };
}

export const SCENARIOS = [
  { objectif: 'Cas nominal', etapes: 'Ouvrir la fiche', resultatAttendu: 'La fiche s’affiche' },
  { objectif: 'Cas d’erreur', etapes: 'Saisir un nom vide', resultatAttendu: 'Un message d’erreur apparaît' },
];

/** Un événement valide de chaque type, avec une charge utile correcte. */
export const EVENEMENTS: Record<TypeEvenement, Evenement> = {
  LANCER_CONCEPTION: { type: 'LANCER_CONCEPTION' },
  SPEC_PRETE: { type: 'SPEC_PRETE', spec: '# Spec\n\nExigences.' },
  LANCER_DEV: { type: 'LANCER_DEV' },
  ITERATION_TERMINEE: { type: 'ITERATION_TERMINEE', iteration: 1, controles: { unitaires: 'vert', non_regression: 'en_cours', exploratoire: 'en_attente' } },
  DEV_TERMINE: { type: 'DEV_TERMINE', urlPreprod: 'https://preprod.exemple.fr', controles: TOUT_VERT, scenarios: SCENARIOS },
  DEPLOYER_PROD: { type: 'DEPLOYER_PROD', confirmation: true },
  ETAPE_DEPLOIEMENT: { type: 'ETAPE_DEPLOIEMENT', etapes: { fusion: 'vert', envoi: 'en_cours', verification: 'en_attente' } },
  DEPLOIEMENT_TERMINE: { type: 'DEPLOIEMENT_TERMINE', version: 'v1.4.0' },
  ECHEC: { type: 'ECHEC', motif: 'Le run a échoué.' },
  QUOTA_ATTEINT: { type: 'QUOTA_ATTEINT', repriseEstimee: '2026-11-17T15:00:00.000Z' },
  RELANCER: { type: 'RELANCER' },
};

/**
 * Prépare le ticket le plus favorable possible à un événement, sauf la colonne qui est imposée.
 * La matrice ne teste donc que la colonne, l'acteur et le blocage.
 */
export function ticketFavorable(colonne: Ticket['colonne'], type: TypeEvenement, bloque: boolean): Ticket {
  const base: Partial<Ticket> = { colonne, spec: '# Spec', specVersion: 1, branche: 'claude/12-fiche-personnage' };
  switch (type) {
    case 'SPEC_PRETE':
      base.runEnCours = 'spec';
      base.spec = null;
      base.specVersion = 0;
      break;
    case 'ITERATION_TERMINEE':
    case 'DEV_TERMINE':
      base.runEnCours = 'dev';
      break;
    case 'ETAPE_DEPLOIEMENT':
    case 'DEPLOIEMENT_TERMINE':
      base.runEnCours = 'deploiement';
      break;
    case 'ECHEC':
    case 'QUOTA_ATTEINT':
      base.runEnCours = colonne === 'conception' ? 'spec' : colonne === 'deploiement' ? 'deploiement' : 'dev';
      break;
    default:
      base.runEnCours = null;
  }
  if (bloque) {
    base.runEnCours = null;
    base.blocage = { motif: 'Le run a échoué.', cause: 'echec', le: MAINTENANT, repriseEstimee: null };
  }
  return ticket(base);
}
