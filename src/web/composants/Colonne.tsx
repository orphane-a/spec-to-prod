import type { ReactNode } from 'react';
import type { DefinitionColonne } from '../../domaine/colonnes';
import { IconeCoche, IconePersonne, IconeRotation } from './Icones';

interface Props {
  definition: DefinitionColonne;
  premiere: boolean;
  nombre: number;
  children: ReactNode;
}

/** Une colonne du tableau, avec son tronçon de voie, sa station et le marqueur de passage. */
export function Colonne({ definition, premiere, nombre, children }: Props) {
  const derniere = definition.passage === null;
  return (
    <section aria-labelledby={`colonne-${definition.id}`} className="colonne">
      <div className="voie">
        <div className="voie-ligne" style={{ left: premiere ? '50%' : 0, right: derniere ? '50%' : -16 }} />
        <div className={`station${derniere ? ' finale' : ''}`} />
        {definition.passage === 'manuel' && (
          <div role="img" aria-label="Passage manuel : vous décidez" className="marqueur manuel">
            <IconePersonne taille={16} />
          </div>
        )}
        {definition.passage === 'automatique' && (
          <div role="img" aria-label="Passage automatique" className="marqueur automatique">
            <IconeRotation taille={16} couleur="#FFFFFF" />
          </div>
        )}
      </div>
      <div className="colonne-titre">
        <div>
          <h2 id={`colonne-${definition.id}`}>{definition.libelle}</h2>
          <span className="compteur" aria-label={`${nombre} ${nombre > 1 ? 'tickets' : 'ticket'}`}>
            {nombre}
          </span>
        </div>
        <p className="ensuite">
          {definition.passage === 'manuel' && <IconePersonne taille={14} />}
          {definition.passage === 'automatique' && <IconeRotation taille={14} epaisseur={2.4} />}
          {definition.passage === null && <IconeCoche taille={14} epaisseur={2.6} />}
          {definition.ensuite}
        </p>
      </div>
      <div className="colonne-corps">{nombre === 0 ? <p className="colonne-vide">{definition.vide}</p> : children}</div>
    </section>
  );
}
