import { z } from 'zod';

export const COLONNES = ['backlog', 'conception', 'dev', 'test', 'deploiement', 'done'] as const;
export type Colonne = (typeof COLONNES)[number];

export const ACTEURS = ['utilisatrice', 'systeme'] as const;
export type Acteur = (typeof ACTEURS)[number];

export const TYPES_RUN = ['spec', 'design', 'dev', 'preprod', 'deploiement'] as const;
export type TypeRun = (typeof TYPES_RUN)[number];

export const etatControleSchema = z.enum(['en_attente', 'en_cours', 'vert', 'rouge']);
export type EtatControle = z.infer<typeof etatControleSchema>;

export const controlesDevSchema = z.object({
  unitaires: etatControleSchema,
  non_regression: etatControleSchema,
  exploratoire: etatControleSchema,
});
export type ControlesDev = z.infer<typeof controlesDevSchema>;

export const etapesDeploiementSchema = z.object({
  fusion: etatControleSchema,
  envoi: etatControleSchema,
  verification: etatControleSchema,
});
export type EtapesDeploiement = z.infer<typeof etapesDeploiementSchema>;

export const scenarioSaisieSchema = z.object({
  objectif: z.string().trim().min(1),
  etapes: z.string().trim().min(1),
  resultatAttendu: z.string().trim().min(1),
});
export type ScenarioSaisie = z.infer<typeof scenarioSaisieSchema>;

export interface Scenario extends ScenarioSaisie {
  id: number;
  fait: boolean;
}

export const SUJETS_COMMENTAIRE = ['general', 'spec', 'design', 'tests'] as const;
export type SujetCommentaire = (typeof SUJETS_COMMENTAIRE)[number];

/** Retour de l'utilisatrice sur un ticket, transmis à Claude au prochain run concerné. */
export interface Commentaire {
  id: number;
  sujet: SujetCommentaire;
  texte: string;
  creeLe: string;
  /** Date de transmission à une session Claude. Null tant qu'il attend. */
  prisEnCompteLe: string | null;
}

/** conflit : la branche du ticket ne se fusionne plus dans la branche principale, le dev doit la remettre à jour. */
export type CauseBlocage = 'echec' | 'quota' | 'iterations' | 'conflit';

export interface Blocage {
  motif: string;
  cause: CauseBlocage;
  le: string;
  repriseEstimee: string | null;
}

export interface Ticket {
  id: number;
  titre: string;
  description: string;
  projetId: number | null;
  colonne: Colonne;
  blocage: Blocage | null;
  runEnCours: TypeRun | null;
  spec: string | null;
  specVersion: number;
  /** Résumé markdown du design : écrans, composants, états et textes. */
  design: string | null;
  /** Lien vers la maquette HTML commitée sur la branche du ticket. */
  urlMaquette: string | null;
  designVersion: number;
  branche: string | null;
  iteration: number;
  iterationMax: number;
  controles: ControlesDev;
  etapesDeploiement: EtapesDeploiement;
  scenarios: Scenario[];
  commentaires: Commentaire[];
  urlPreprod: string | null;
  versionDeployee: string | null;
  deployeLe: string | null;
  creeLe: string;
  modifieLe: string;
}

/** Événements acceptés par la machine à états. Les schémas servent aussi à valider les webhooks. */
export const evenementSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('LANCER_CONCEPTION') }),
  z.object({ type: z.literal('SPEC_PRETE'), spec: z.string() }),
  z.object({ type: z.literal('LANCER_DESIGN') }),
  z.object({ type: z.literal('DESIGN_PRET'), resume: z.string(), urlMaquette: z.string() }),
  z.object({ type: z.literal('LANCER_DEV') }),
  z.object({
    type: z.literal('ITERATION_TERMINEE'),
    iteration: z.number().int().positive(),
    controles: controlesDevSchema,
  }),
  z.object({
    type: z.literal('DEV_TERMINE'),
    controles: controlesDevSchema,
    scenarios: z.array(scenarioSaisieSchema),
  }),
  z.object({ type: z.literal('PREPROD_DEPLOYEE'), urlPreprod: z.string(), version: z.string() }),
  z.object({ type: z.literal('DEPLOYER_PROD'), confirmation: z.boolean() }),
  z.object({ type: z.literal('ETAPE_DEPLOIEMENT'), etapes: etapesDeploiementSchema }),
  z.object({ type: z.literal('DEPLOIEMENT_TERMINE'), version: z.string() }),
  z.object({ type: z.literal('ECHEC'), motif: z.string(), conflit: z.boolean().optional() }),
  z.object({ type: z.literal('QUOTA_ATTEINT'), repriseEstimee: z.string().nullable() }),
  z.object({ type: z.literal('RELANCER') }),
  // Relances déclenchées par un commentaire de l'utilisatrice, en conception.
  z.object({ type: z.literal('RETRAVAILLER_SPEC') }),
  z.object({ type: z.literal('RETRAVAILLER_DESIGN') }),
]);
export type Evenement = z.infer<typeof evenementSchema>;
export type TypeEvenement = Evenement['type'];

export const TYPES_EVENEMENT = [
  'LANCER_CONCEPTION',
  'SPEC_PRETE',
  'LANCER_DESIGN',
  'DESIGN_PRET',
  'LANCER_DEV',
  'ITERATION_TERMINEE',
  'DEV_TERMINE',
  'PREPROD_DEPLOYEE',
  'DEPLOYER_PROD',
  'ETAPE_DEPLOIEMENT',
  'DEPLOIEMENT_TERMINE',
  'ECHEC',
  'QUOTA_ATTEINT',
  'RELANCER',
  'RETRAVAILLER_SPEC',
  'RETRAVAILLER_DESIGN',
] as const satisfies readonly TypeEvenement[];

export type TypeJournal = 'transition' | 'action' | 'iteration' | 'test' | 'blocage' | 'deblocage' | 'deploiement' | 'spec' | 'design' | 'commentaire';

export interface EntreeJournal {
  type: TypeJournal;
  detail: string;
}

export interface EvenementJournal extends EntreeJournal {
  id: number;
  ticketId: number;
  date: string;
}

export type Effet = { type: 'DEMARRER_RUN'; run: TypeRun };

export type CodeRefus =
  | 'ACTEUR_INTERDIT'
  | 'TRANSITION_INTERDITE'
  | 'TICKET_BLOQUE'
  | 'TICKET_TERMINE'
  | 'CONDITION_NON_REMPLIE';

export type ResultatTransition =
  | { ok: true; ticket: Ticket; journal: EntreeJournal[]; effets: Effet[] }
  | { ok: false; code: CodeRefus; message: string };

export interface ContexteTransition {
  /** Date ISO de la transition, injectée pour garder la machine pure et testable. */
  maintenant: string;
  /**
   * Autre ticket du même projet qui occupe déjà la préprod (en test ou en cours de déploiement).
   * Un projet n'a qu'une préprod : un seul ticket à la fois.
   */
  preprodOccupeePar?: number | null;
}
