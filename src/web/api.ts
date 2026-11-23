import type { EvenementJournal, Nature, SujetCommentaire, Ticket } from '../domaine/types';

export interface Projet {
  id: number;
  nom: string;
}

export interface Quota {
  pourcentageSemaine: number;
  epuise: boolean;
  repriseEstimee: string | null;
  misAJourLe: string;
}

export interface SaisieTicket {
  titre: string;
  description: string;
  projetId: number | null;
  nature?: Nature;
}

export type Action = 'lancer-conception' | 'lancer-design' | 'lancer-dev' | 'lancer-correction' | 'deployer-prod' | 'relancer';

export class ErreurApi extends Error {}

async function requete<T>(url: string, init: RequestInit = {}): Promise<T> {
  let reponse: Response;
  try {
    reponse = await fetch(url, {
      ...init,
      headers: init.body ? { 'Content-Type': 'application/json', ...init.headers } : init.headers,
    });
  } catch {
    throw new ErreurApi('Le serveur ne répond pas. Vérifiez votre connexion puis réessayez.');
  }
  if (reponse.status === 204) return undefined as T;
  const corps = await reponse.json().catch(() => null);
  // Session expirée : la garde de l'application affiche l'écran de connexion.
  if (reponse.status === 401 && corps?.code === 'NON_CONNECTE') window.dispatchEvent(new Event(EVENEMENT_DECONNEXION));
  if (!reponse.ok) throw new ErreurApi(corps?.message ?? 'Une erreur inattendue est survenue.');
  return corps as T;
}

export const EVENEMENT_DECONNEXION = 'spec-to-prod:deconnecte';

export interface EtatSession {
  protege: boolean;
  connecte: boolean;
}

const json = (corps: unknown) => JSON.stringify(corps);

export const api = {
  session: () => requete<EtatSession>('/api/session'),
  connexion: (motDePasse: string) => requete<void>('/api/connexion', { method: 'POST', body: json({ motDePasse }) }),
  deconnexion: () => requete<void>('/api/deconnexion', { method: 'POST' }),
  tickets: () => requete<Ticket[]>('/api/tickets'),
  projets: () => requete<Projet[]>('/api/projets'),
  quota: () => requete<Quota>('/api/quota'),
  journal: (id: number) => requete<EvenementJournal[]>(`/api/tickets/${id}/journal`),
  creer: (saisie: SaisieTicket) => requete<Ticket>('/api/tickets', { method: 'POST', body: json(saisie) }),
  modifier: (id: number, saisie: SaisieTicket) => requete<Ticket>(`/api/tickets/${id}`, { method: 'PATCH', body: json(saisie) }),
  supprimer: (id: number) => requete<void>(`/api/tickets/${id}`, { method: 'DELETE' }),
  agir: (id: number, action: Action, corps?: unknown) =>
    requete<Ticket>(`/api/tickets/${id}/actions/${action}`, { method: 'POST', body: json(corps ?? {}) }),
  corrigerSpec: (id: number, spec: string) => requete<Ticket>(`/api/tickets/${id}/spec`, { method: 'PATCH', body: json({ spec }) }),
  corrigerDesign: (id: number, design: string, urlMaquette: string) =>
    requete<Ticket>(`/api/tickets/${id}/design`, { method: 'PATCH', body: json({ design, urlMaquette }) }),
  commenter: (id: number, sujet: SujetCommentaire, texte: string) =>
    requete<Ticket>(`/api/tickets/${id}/commentaires`, { method: 'POST', body: json({ sujet, texte }) }),
  supprimerCommentaire: (id: number, commentaireId: number) =>
    requete<Ticket>(`/api/tickets/${id}/commentaires/${commentaireId}`, { method: 'DELETE' }),
  marquerScenario: (id: number, ordre: number, fait: boolean) =>
    requete<Ticket>(`/api/tickets/${id}/scenarios/${ordre}`, { method: 'PATCH', body: json({ fait }) }),
};
