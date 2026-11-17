import { useEffect, useRef, type ReactNode } from 'react';
import { IconeCroix } from './Icones';

interface Props {
  titre: string;
  fermer: () => void;
  variante?: 'fenetre' | 'panneau';
  children: ReactNode;
}

/** Fenêtre modale native : focus piégé, touche Échap et retour du focus gérés par le navigateur. */
export function Fenetre({ titre, fermer, variante = 'fenetre', children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialogue = ref.current;
    if (dialogue && !dialogue.open) dialogue.showModal();
    return () => dialogue?.close();
  }, []);

  return (
    <dialog
      ref={ref}
      className={variante}
      aria-labelledby="titre-fenetre"
      onCancel={(e) => {
        e.preventDefault();
        fermer();
      }}
      onClick={(e) => {
        if (e.target === ref.current) fermer();
      }}
    >
      <div className="fenetre-contenu">
        <div className="fenetre-entete">
          <h2 id="titre-fenetre">{titre}</h2>
          <button type="button" className="bouton-fermer" onClick={fermer} aria-label="Fermer">
            <IconeCroix couleur="var(--encre)" />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
