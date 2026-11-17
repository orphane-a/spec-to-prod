import { COLONNES, type Colonne, type ControlesDev, type EtapesDeploiement } from './types';

export interface DefinitionColonne {
  id: Colonne;
  libelle: string;
  /** Phrase sous le nom de la colonne : ce qui se passe ensuite. */
  ensuite: string;
  /** Qui décide du passage vers la colonne suivante. null pour Done. */
  passage: 'manuel' | 'automatique' | null;
  vide: string;
}

export const DEFINITIONS_COLONNES: readonly DefinitionColonne[] = [
  { id: 'backlog', libelle: 'Backlog', ensuite: 'Vous lancez la conception', passage: 'manuel', vide: 'Aucune idée en attente. Ajoutez un ticket pour commencer.' },
  { id: 'conception', libelle: 'En conception', ensuite: 'Vous lancez le développement', passage: 'manuel', vide: 'Aucune spec en cours de rédaction.' },
  { id: 'dev', libelle: 'En dev', ensuite: 'Passe seul en test', passage: 'automatique', vide: 'Aucun ticket en développement.' },
  { id: 'test', libelle: 'En test', ensuite: 'Vous lancez la mise en prod', passage: 'manuel', vide: 'Aucun ticket à tester pour l’instant.' },
  { id: 'deploiement', libelle: 'Déploiement en prod', ensuite: 'Passe seul en Done', passage: 'automatique', vide: 'Aucun déploiement en cours.' },
  { id: 'done', libelle: 'Done', ensuite: 'En ligne', passage: null, vide: 'Aucun ticket en ligne pour l’instant.' },
];

export function indexColonne(colonne: Colonne): number {
  return COLONNES.indexOf(colonne);
}

export function definitionColonne(colonne: Colonne): DefinitionColonne {
  const def = DEFINITIONS_COLONNES.find((d) => d.id === colonne);
  if (!def) throw new Error(`Colonne inconnue : ${colonne}`);
  return def;
}

export const CONTROLES_INITIAUX: ControlesDev = { unitaires: 'en_attente', non_regression: 'en_attente', exploratoire: 'en_attente' };
export const ETAPES_INITIALES: EtapesDeploiement = { fusion: 'en_attente', envoi: 'en_attente', verification: 'en_attente' };

/** Nom de branche prévisible : identifiant du ticket et titre court. */
export function nomBranche(id: number, titre: string): string {
  const slug = titre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return `claude/${id}${slug ? `-${slug}` : ''}`;
}
