import { z } from 'zod';
import type { Colonne, Ticket } from './types';

/**
 * Correction à la main de la spec et du design d'un ticket.
 * Ce n'est pas une transition : le ticket garde sa colonne et la machine à états n'intervient pas.
 */

export const COLONNES_CORRIGEABLES = ['conception', 'dev'] as const satisfies readonly Colonne[];

export type CodeRefusCorrection = 'COLONNE_NON_CORRIGEABLE' | 'RUN_EN_COURS';

export interface RefusCorrection {
  code: CodeRefusCorrection;
  message: string;
}

/**
 * Une correction est permise en conception et en dev, tant qu'aucun run ne tourne :
 * un run en cours écraserait la correction à son retour, ou travaillerait sur un texte périmé.
 * Un ticket Bloqué reste corrigeable, c'est même le cas le plus utile.
 */
export function refusCorrection(ticket: Pick<Ticket, 'colonne' | 'runEnCours'>): RefusCorrection | null {
  if (!(COLONNES_CORRIGEABLES as readonly Colonne[]).includes(ticket.colonne)) {
    return { code: 'COLONNE_NON_CORRIGEABLE', message: 'La spec et le design se corrigent seulement en conception ou en dev.' };
  }
  if (ticket.runEnCours !== null) {
    return { code: 'RUN_EN_COURS', message: 'Un run est en cours, attends sa fin pour corriger la spec ou le design.' };
  }
  return null;
}

export function estUrlHttps(valeur: string): boolean {
  try {
    const url = new URL(valeur);
    return url.protocol === 'https:' && url.hostname !== '';
  } catch {
    return false;
  }
}

const MESSAGE_CORPS_INVALIDE = 'Les données envoyées sont invalides.';

export const correctionSpecSchema = z.object(
  { spec: z.string('La spec doit être un texte.').trim().min(1, 'La spec ne peut pas être vide.') },
  MESSAGE_CORPS_INVALIDE,
);
export type CorrectionSpec = z.infer<typeof correctionSpecSchema>;

export const correctionDesignSchema = z.object(
  {
    design: z.string('Le résumé du design doit être un texte.').trim().min(1, 'Le résumé du design ne peut pas être vide.'),
    urlMaquette: z
      .string('Le lien de la maquette est obligatoire.')
      .trim()
      .refine(estUrlHttps, 'Le lien de la maquette doit être une adresse https valide.'),
  },
  MESSAGE_CORPS_INVALIDE,
);
export type CorrectionDesign = z.infer<typeof correctionDesignSchema>;

export const detailJournalSpec = (version: number) => `Spec modifiée à la main (version ${version}).`;
export const detailJournalDesign = (version: number) => `Design modifié à la main (version ${version}).`;
