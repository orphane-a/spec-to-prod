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
 * Sujets lus par chaque étape Claude. Chaque étape ne consomme que les retours qu'elle peut traiter :
 * un retour sur la spec attend une nouvelle rédaction de la spec, même si un design passe avant.
 * Le dev reçoit tout ce qui reste.
 */
const SUJETS_PAR_ETAPE: Partial<Record<TypeRun, readonly SujetCommentaire[]>> = {
  spec: ['general', 'spec'],
  design: ['general', 'design'],
  dev: SUJETS_COMMENTAIRE,
};

/** Commentaires en attente que l'étape doit recevoir, dans l'ordre où ils ont été écrits. */
export function commentairesATransmettre(ticket: Pick<Ticket, 'commentaires'>, etape: TypeRun): Commentaire[] {
  const sujets = SUJETS_PAR_ETAPE[etape];
  if (!sujets) return [];
  return ticket.commentaires.filter((c) => c.prisEnCompteLe === null && sujets.includes(c.sujet));
}

/**
 * Relance demandée par les commentaires en attente d'un ticket en conception, au repos et non bloqué.
 * Un retour sur la spec (ou général) relance la spec, et le design suivra ; sinon un retour sur le design relance le design.
 * Les retours sur les tests attendent le dev. Un ticket bloqué attend Relancer, jamais une relance seule.
 */
export function relanceParCommentaires(ticket: Ticket): 'RETRAVAILLER_SPEC' | 'RETRAVAILLER_DESIGN' | null {
  if (ticket.colonne !== 'conception' || ticket.runEnCours || ticket.blocage || !ticket.spec?.trim()) return null;
  const sujets = new Set(ticket.commentaires.filter((c) => c.prisEnCompteLe === null).map((c) => c.sujet));
  if (sujets.has('spec') || sujets.has('general')) return 'RETRAVAILLER_SPEC';
  if (sujets.has('design')) return 'RETRAVAILLER_DESIGN';
  return null;
}

export function detailJournalAjout(sujet: SujetCommentaire): string {
  const cible = { general: '', spec: ' sur la spec', design: ' sur le design', tests: ' sur les tests' }[sujet];
  return `Commentaire ajouté${cible}.`;
}

export function detailJournalTransmission(nombre: number): string {
  return nombre === 1 ? '1 commentaire transmis à Claude.' : `${nombre} commentaires transmis à Claude.`;
}
