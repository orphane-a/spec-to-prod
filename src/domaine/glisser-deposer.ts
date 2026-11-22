import { indexColonne } from './colonnes';
import { transition } from './machine-etats';
import type { Colonne, Evenement, Ticket } from './types';

/**
 * Traduit un dépôt de carte dans une colonne en décision de la machine à états.
 * Le glisser-déposer ne crée aucun passage : il déclenche seulement les décisions manuelles.
 */

export type ActionDepot = 'LANCER_CONCEPTION' | 'LANCER_DEV' | 'LANCER_CORRECTION' | 'DEPLOYER_PROD';

export type ResultatDepot =
  | { type: 'meme_colonne' }
  | { type: 'action'; action: ActionDepot }
  | { type: 'refus'; message: string };

/** Colonne d'arrivée de chaque décision manuelle. */
const ACTION_PAR_COLONNE: Partial<Record<Colonne, ActionDepot>> = {
  conception: 'LANCER_CONCEPTION',
  dev: 'LANCER_DEV',
  deploiement: 'DEPLOYER_PROD',
};

const refus = (message: string): ResultatDepot => ({ type: 'refus', message });

function verdict(ticket: Ticket, action: ActionDepot): ResultatDepot {
  // La confirmation de mise en prod est demandée après le dépôt : on vérifie ici le reste des conditions.
  const evenement: Evenement = action === 'DEPLOYER_PROD' ? { type: action, confirmation: true } : { type: action };
  const r = transition(ticket, evenement, 'utilisatrice', { maintenant: ticket.modifieLe });
  return r.ok ? { type: 'action', action } : refus(r.message);
}

export function resultatDepot(ticket: Ticket, cible: Colonne): ResultatDepot {
  if (cible === ticket.colonne) return { type: 'meme_colonne' };
  if (ticket.colonne === 'done') return refus('Ce ticket est en ligne : il ne bouge plus.');

  // Un bug saute la conception : du backlog, il part directement en dev.
  if (ticket.nature === 'bug' && ticket.colonne === 'backlog') {
    if (cible === 'dev') return verdict(ticket, 'LANCER_CORRECTION');
    if (cible === 'conception') return refus('Un bug se corrige directement : il ne passe pas par la conception.');
  }

  const ecart = indexColonne(cible) - indexColonne(ticket.colonne);
  if (ecart < 0) return refus('Un ticket ne revient pas en arrière.');
  if (ecart > 1) return refus('Un ticket ne saute pas de colonne : il avance une étape à la fois.');

  const action = ACTION_PAR_COLONNE[cible];
  if (!action) return refus('Ce passage est automatique : il ne se déclenche pas à la main.');

  return verdict(ticket, action);
}
