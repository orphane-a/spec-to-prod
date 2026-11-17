import { useState, type FormEvent } from 'react';
import type { Ticket } from '../../domaine/types';
import type { Projet, SaisieTicket } from '../api';
import { Fenetre } from './Fenetre';

interface Props {
  projets: Projet[];
  ticket?: Ticket;
  projetParDefaut: number | null;
  enregistrer: (saisie: SaisieTicket) => Promise<void>;
  fermer: () => void;
}

export function FormulaireTicket({ projets, ticket, projetParDefaut, enregistrer, fermer }: Props) {
  const [titre, setTitre] = useState(ticket?.titre ?? '');
  const [description, setDescription] = useState(ticket?.description ?? '');
  const [projetId, setProjetId] = useState<number | null>(ticket ? ticket.projetId : projetParDefaut);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function soumettre(e: FormEvent) {
    e.preventDefault();
    if (!titre.trim()) {
      setErreur('Le titre est obligatoire.');
      return;
    }
    setEnvoi(true);
    setErreur(null);
    try {
      await enregistrer({ titre: titre.trim(), description: description.trim(), projetId });
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Enregistrement impossible.');
      setEnvoi(false);
    }
  }

  return (
    <Fenetre titre={ticket ? 'Modifier le ticket' : 'Ajouter un ticket au backlog'} fermer={fermer}>
      <form onSubmit={soumettre} className="fenetre-contenu" style={{ padding: 0 }} noValidate>
        <label className="champ">
          Titre
          <input value={titre} onChange={(e) => setTitre(e.target.value)} maxLength={120} required autoFocus aria-invalid={erreur !== null && !titre.trim()} />
        </label>
        <label className="champ">
          Description
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} placeholder="Décrivez l'idée en quelques phrases." />
        </label>
        <label className="champ">
          Projet
          <select value={projetId ?? ''} onChange={(e) => setProjetId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Aucun projet</option>
            {projets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nom}
              </option>
            ))}
          </select>
        </label>
        {erreur && (
          <p className="message-erreur" role="alert">
            {erreur}
          </p>
        )}
        <div className="actions">
          <button type="button" className="bouton bouton-contour" onClick={fermer}>
            Annuler
          </button>
          <button type="submit" className="bouton bouton-encre" disabled={envoi}>
            {ticket ? 'Enregistrer' : 'Ajouter au backlog'}
          </button>
        </div>
      </form>
    </Fenetre>
  );
}
