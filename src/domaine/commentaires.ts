import { z } from 'zod';
import { SUJETS_COMMENTAIRE, type Commentaire, type SujetCommentaire, type Ticket, type TypeRun } from './types';

/**
 * Commentaires d'un ticket : des retours sur la spec, le design ou les tests.
 * Ce ne sont pas des transitions : commenter ne change jamais la colonne et ne lance aucun run.
 * Les commentaires en attente partent avec le prochain run Claude qui les concerne.
 */

export const TAILLE_MAX_COMMENTAIRE = 5000;

export const commentaireSaisieSchema = z.object(
  {
    sujet: z.enum(SUJETS_COMMENTAIRE, 'Choisis le sujet du commentaire.'),
    texte: z
      .string('Le commentaire ne peut pas être vide.')
      .trim()
      .min(1, 'Le commentaire ne peut pas être vide.')
      .max(TAILLE_MAX_COMMENTAIRE, 'Le commentaire fait 5 000 caractères au plus.'),
  },
  'Les données envoyées sont invalides.',
);
export type CommentaireSaisie = z.infer<typeof commentaireSaisieSchema>;

export const LIBELLES_SUJET: Record<SujetCommentaire, string> = {
  general: 'Général',
  spec: 'Spec',
  design: 'Design',
  tests: 'Tests',
};

/**
 * Sujets lus par chaque étape Claude. La spec ne lit pas les retours sur le design ou les tests,
 * qui attendent l'étape qui peut s'en servir. Le dev reçoit tout ce qui reste.
 */
const SUJETS_PAR_ETAPE: Partial<Record<TypeRun, readonly SujetCommentaire[]>> = {
  spec: ['general', 'spec'],
  design: ['general', 'spec', 'design'],
  dev: SUJETS_COMMENTAIRE,
};

/** Commentaires en attente que l'étape doit recevoir, dans l'ordre où ils ont été écrits. */
export function commentairesATransmettre(ticket: Pick<Ticket, 'commentaires'>, etape: TypeRun): Commentaire[] {
  const sujets = SUJETS_PAR_ETAPE[etape];
  if (!sujets) return [];
  return ticket.commentaires.filter((c) => c.prisEnCompteLe === null && sujets.includes(c.sujet));
}

export function detailJournalAjout(sujet: SujetCommentaire): string {
  const cible = { general: '', spec: ' sur la spec', design: ' sur le design', tests: ' sur les tests' }[sujet];
  return `Commentaire ajouté${cible}.`;
}

export function detailJournalTransmission(nombre: number): string {
  return nombre === 1 ? '1 commentaire transmis à Claude.' : `${nombre} commentaires transmis à Claude.`;
}
