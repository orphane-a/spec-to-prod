import { useState, type FormEvent, type KeyboardEvent } from 'react';
import type { Ticket } from '../../domaine/types';
import { api } from '../api';

interface Props {
  genre: 'spec' | 'design';
  ticket: Ticket;
  remplacer: (ticket: Ticket) => void;
  /** Appelé après l'enregistrement ou l'annulation. */
  termine: () => void;
}

/**
 * Éditeur de la spec ou du design d'un ticket, en markdown.
 * Pour le design, il porte aussi le lien de la maquette.
 * Le serveur reste juge : ses messages d'erreur, en français, s'affichent tels quels.
 */
export function EditeurCorrection({ genre, ticket, remplacer, termine }: Props) {
  const estDesign = genre === 'design';
  const [texte, setTexte] = useState((estDesign ? ticket.design : ticket.spec) ?? '');
  const [lien, setLien] = useState(ticket.urlMaquette ?? '');
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function soumettre(e: FormEvent) {
    e.preventDefault();
    setEnvoi(true);
    setErreur(null);
    try {
      remplacer(estDesign ? await api.corrigerDesign(ticket.id, texte, lien) : await api.corrigerSpec(ticket.id, texte));
      termine();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Enregistrement impossible.');
      setEnvoi(false);
    }
  }

  // Échap annule seulement l'édition : la fiche reste ouverte et rien d'autre n'est perdu.
  function surTouche(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    termine();
  }

  return (
    <form onSubmit={soumettre} onKeyDown={surTouche} className="fenetre-contenu" style={{ padding: 0 }} noValidate>
      <label className="champ">
        {estDesign ? 'Résumé du design en markdown' : 'Spec en markdown'}
        <textarea className="editeur-texte" value={texte} onChange={(e) => setTexte(e.target.value)} autoFocus spellCheck lang="fr" />
      </label>
      {estDesign && (
        <label className="champ">
          Lien de la maquette
          <input type="url" value={lien} onChange={(e) => setLien(e.target.value)} placeholder="https://" inputMode="url" autoComplete="off" />
        </label>
      )}
      {erreur && (
        <p className="message-erreur" role="alert">
          {erreur}
        </p>
      )}
      <div className="actions">
        <button type="button" className="bouton bouton-contour" onClick={termine} disabled={envoi}>
          Annuler
        </button>
        <button type="submit" className="bouton bouton-encre" disabled={envoi}>
          Enregistrer
        </button>
      </div>
    </form>
  );
}
