export class ErreurMetier extends Error {
  constructor(
    readonly statut: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const introuvable = (quoi = 'Ticket') => new ErreurMetier(404, 'INTROUVABLE', `${quoi} introuvable.`);
