import { useCallback, useEffect, useState } from 'react';
import type { Ticket } from '../domaine/types';
import { api, type Projet, type Quota } from './api';

type MessageFlux =
  | { type: 'ticket'; ticket: Ticket }
  | { type: 'ticket_supprime'; id: number }
  | { type: 'quota'; quota: Quota };

export interface EtatTableau {
  tickets: Ticket[];
  projets: Projet[];
  quota: Quota | null;
  chargement: boolean;
  erreur: string | null;
  connecte: boolean;
  remplacer: (ticket: Ticket) => void;
  retirer: (id: number) => void;
}

/** Charge le tableau puis le garde à jour grâce au flux SSE du serveur. */
export function useTableau(): EtatTableau {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [projets, setProjets] = useState<Projet[]>([]);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [connecte, setConnecte] = useState(false);

  const remplacer = useCallback((ticket: Ticket) => {
    setTickets((liste) => {
      const existe = liste.some((t) => t.id === ticket.id);
      return existe ? liste.map((t) => (t.id === ticket.id ? ticket : t)) : [ticket, ...liste];
    });
  }, []);

  const retirer = useCallback((id: number) => setTickets((liste) => liste.filter((t) => t.id !== id)), []);

  const recharger = useCallback(async () => {
    try {
      const [t, p, q] = await Promise.all([api.tickets(), api.projets(), api.quota()]);
      setTickets(t);
      setProjets(p);
      setQuota(q);
      setErreur(null);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Chargement impossible.');
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => {
    void recharger();
    const flux = new EventSource('/api/flux');
    flux.onopen = () => {
      setConnecte(true);
      // Après une coupure, on recharge pour ne rien manquer.
      void recharger();
    };
    flux.onerror = () => setConnecte(false);
    flux.onmessage = (e) => {
      const message = JSON.parse(e.data) as MessageFlux;
      if (message.type === 'ticket') remplacer(message.ticket);
      else if (message.type === 'ticket_supprime') retirer(message.id);
      else setQuota(message.quota);
    };
    return () => flux.close();
  }, [recharger, remplacer, retirer]);

  return { tickets, projets, quota, chargement, erreur, connecte, remplacer, retirer };
}
