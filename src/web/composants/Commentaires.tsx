import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { LIBELLES_SUJET } from '../../domaine/commentaires';
import { SUJETS_COMMENTAIRE, type SujetCommentaire, type Ticket } from '../../domaine/types';
import { api } from '../api';
import { formaterHorodatage } from '../format';

interface Props {
  ticket: Ticket;
  sujetInitial: SujetCommentaire;
  remplacer: (ticket: Ticket) => void;
}

/**
 * Retours de l'utilisatrice sur la spec, le design ou les tests.
 * Ils attendent le prochain run Claude qui les concerne, puis passent en « transmis ».
 */
export function Commentaires({ ticket, sujetInitial, remplacer }: Props) {
  const [sujet, setSujet] = useState<SujetCommentaire>(sujetInitial);
  const [texte, setTexte] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function soumettre(e?: FormEvent) {
    e?.preventDefault();
    if (envoi) return;
    setEnvoi(true);
    setErreur(null);
    try {
      remplacer(await api.commenter(ticket.id, sujet, texte));
      setTexte('');
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Envoi impossible.');
    } finally {
      setEnvoi(false);
    }
  }

  async function supprimer(id: number) {
    setErreur(null);
    try {
      remplacer(await api.supprimerCommentaire(ticket.id, id));
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Suppression impossible.');
    }
  }

  // Ctrl+Entrée (ou Cmd+Entrée) envoie sans quitter le clavier.
  function surTouche(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void soumettre();
    }
  }

  return (
    <div className="fenetre-contenu" style={{ padding: 0 }}>
      <p className="texte-petit" style={{ margin: 0 }}>
        Tes commentaires partent avec le prochain run de Claude qui les concerne. La spec lit les commentaires généraux et ceux sur la spec, le design y
        ajoute ceux sur le design, le dev les lit tous.
      </p>

      {ticket.commentaires.length === 0 ? (
        <p className="texte">Aucun commentaire pour l’instant.</p>
      ) : (
        <ol className="liste-commentaires">
          {ticket.commentaires.map((c) => (
            <li key={c.id} className="commentaire">
              <div className="commentaire-entete">
                <span className="etiquette">{LIBELLES_SUJET[c.sujet]}</span>
                <time dateTime={c.creeLe}>{formaterHorodatage(c.creeLe)}</time>
              </div>
              <p className="commentaire-texte">{c.texte}</p>
              <div className="commentaire-pied">
                {c.prisEnCompteLe ? (
                  <span className="commentaire-statut transmis">Transmis à Claude le {formaterHorodatage(c.prisEnCompteLe)}</span>
                ) : (
                  <>
                    <span className="commentaire-statut">En attente du prochain run</span>
                    <button type="button" className="bouton-lien" onClick={() => supprimer(c.id)}>
                      Supprimer
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}

      <form onSubmit={soumettre} className="formulaire-commentaire" noValidate>
        <label className="champ">
          Sujet
          <select value={sujet} onChange={(e) => setSujet(e.target.value as SujetCommentaire)}>
            {SUJETS_COMMENTAIRE.map((s) => (
              <option key={s} value={s}>
                {LIBELLES_SUJET[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="champ">
          Ton commentaire
          <textarea
            id="nouveau-commentaire"
            value={texte}
            onChange={(e) => setTexte(e.target.value)}
            onKeyDown={surTouche}
            maxLength={5000}
            spellCheck
            lang="fr"
            placeholder="Par exemple : le bouton d’envoi doit rester visible sur mobile."
          />
        </label>
        {erreur && (
          <p className="message-erreur" role="alert">
            {erreur}
          </p>
        )}
        <div className="actions">
          <span className="texte-petit">Ctrl+Entrée pour envoyer</span>
          <button type="submit" className="bouton bouton-encre" disabled={envoi || texte.trim() === ''}>
            Envoyer
          </button>
        </div>
      </form>
    </div>
  );
}
