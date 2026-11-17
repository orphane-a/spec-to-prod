import { useState, type ReactNode } from 'react';
import { Fenetre } from './Fenetre';

interface Props {
  titre: string;
  children: ReactNode;
  libelleConfirmer: string;
  variante?: 'ambre' | 'danger';
  confirmer: () => Promise<void>;
  fermer: () => void;
}

export function Confirmation({ titre, children, libelleConfirmer, variante = 'ambre', confirmer, fermer }: Props) {
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function valider() {
    setEnvoi(true);
    setErreur(null);
    try {
      await confirmer();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Action impossible.');
      setEnvoi(false);
    }
  }

  return (
    <Fenetre titre={titre} fermer={fermer}>
      <div className="section">{children}</div>
      {erreur && (
        <p className="message-erreur" role="alert">
          {erreur}
        </p>
      )}
      <div className="actions">
        <button type="button" className="bouton bouton-contour" onClick={fermer} autoFocus>
          Annuler
        </button>
        <button type="button" className={`bouton ${variante === 'danger' ? 'bouton-danger' : 'bouton-ambre'}`} disabled={envoi} onClick={valider}>
          {libelleConfirmer}
        </button>
      </div>
    </Fenetre>
  );
}
