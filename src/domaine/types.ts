import { z } from 'zod';

export const COLONNES = ['backlog', 'conception', 'dev', 'test', 'deploiement', 'done'] as const;
export type Colonne = (typeof COLONNES)[number];

export const ACTEURS = ['utilisatrice', 'systeme'] as const;
export type Acteur = (typeof ACTEURS)[number];

export const TYPES_RUN = ['spec', 'dev', 'deploiement'] as const;
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

export type CauseBlocage = 'echec' | 'quota' | 'iterations';

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
  branche: string | null;
  iteration: number;
  iterationMax: number;
  controles: ControlesDev;
  etapesDeploiement: EtapesDeploiement;
  scenarios: Scenario[];
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
  z.object({ type: z.literal('LANCER_DEV') }),
  z.object({
    type: z.literal('ITERATION_TERMINEE'),
    iteration: z.number().int().positive(),
    controles: controlesDevSchema,
  }),
  z.object({
    type: z.literal('DEV_TERMINE'),
    urlPreprod: z.string(),
    controles: controlesDevSchema,
    scenarios: z.array(scenarioSaisieSchema),
  }),
  z.object({ type: z.literal('DEPLOYER_PROD'), confirmation: z.boolean() }),
  z.object({ type: z.literal('ETAPE_DEPLOIEMENT'), etapes: etapesDeploiementSchema }),
  z.object({ type: z.literal('DEPLOIEMENT_TERMINE'), version: z.string() }),
  z.object({ type: z.literal('ECHEC'), motif: z.string() }),
  z.object({ type: z.literal('QUOTA_ATTEINT'), repriseEstimee: z.string().nullable() }),
  z.object({ type: z.literal('RELANCER') }),
]);
export type Evenement = z.infer<typeof evenementSchema>;
export type TypeEvenement = Evenement['type'];

export const TYPES_EVENEMENT = [
  'LANCER_CONCEPTION',
  'SPEC_PRETE',
  'LANCER_DEV',
  'ITERATION_TERMINEE',
  'DEV_TERMINE',
  'DEPLOYER_PROD',
  'ETAPE_DEPLOIEMENT',
  'DEPLOIEMENT_TERMINE',
  'ECHEC',
  'QUOTA_ATTEINT',
  'RELANCER',
] as const satisfies readonly TypeEvenement[];

export type TypeJournal = 'transition' | 'action' | 'iteration' | 'test' | 'blocage' | 'deblocage' | 'deploiement' | 'spec';

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
}
