import type { DragEvent, ReactNode } from 'react';
import type { DefinitionColonne } from '../../domaine/colonnes';
import type { ResultatDepot } from '../../domaine/glisser-deposer';
import { IconeCoche, IconePersonne, IconeRotation } from './Icones';

/** Ce que la colonne doit savoir pendant qu'une carte est glissée. */
export interface Depot {
  /** null quand aucune carte n'est glissée. */
  resultat: ResultatDepot | null;
  survolee: boolean;
  entrer: () => void;
  sortir: () => void;
  deposer: () => void;
}

interface Props {
  definition: DefinitionColonne;
  premiere: boolean;
  nombre: number;
  depot: Depot;
  /** Ligne des bugs : en-tête réduit au nom de la colonne, sans voie. */
  ligneBugs?: boolean;
  children: ReactNode;
}

/** Messages de la ligne des bugs quand une colonne est vide. */
const VIDES_BUGS: Record<DefinitionColonne['id'], string> = {
  backlog: 'Aucun bug signalé.',
  conception: 'Pas de spec pour un bug : la carte passe directement en dev.',
  dev: 'Aucun bug en correction.',
  test: 'Aucun bug à tester pour l’instant.',
  deploiement: 'Aucun bug en cours de déploiement.',
  done: 'Aucun bug corrigé pour l’instant.',
};

/** Une colonne du tableau, avec son tronçon de voie, sa station et le marqueur de passage. */
export function Colonne({ definition, premiere, nombre, depot, ligneBugs = false, children }: Props) {
  const derniere = definition.passage === null;
  const { resultat, survolee } = depot;
  const accepte = resultat?.type === 'action';
  const refus = survolee && resultat?.type === 'refus' ? resultat.message : null;

  const classes = ['colonne-corps'];
  if (accepte) classes.push('depot-possible');
  if (accepte && survolee) classes.push('depot-survol');
  if (refus) classes.push('depot-refuse');

  function survoler(e: DragEvent) {
    if (!resultat) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = accepte ? 'move' : 'none';
    if (!survolee) depot.entrer();
  }

  function quitter(e: DragEvent) {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    depot.sortir();
  }

  function lacher(e: DragEvent) {
    e.preventDefault();
    if (accepte) depot.deposer();
    else depot.sortir();
  }

  const corps = (
    <div className={classes.join(' ')} onDragOver={survoler} onDragLeave={quitter} onDrop={lacher}>
      {refus && (
        <p className="depot-message" role="status">
          {refus}
        </p>
      )}
      {nombre === 0 ? (
        <p className={ligneBugs && definition.id === 'conception' ? 'colonne-vide sans-etape' : 'colonne-vide'}>{ligneBugs ? VIDES_BUGS[definition.id] : definition.vide}</p>
      ) : (
        children
      )}
    </div>
  );

  if (ligneBugs) {
    return (
      <section aria-label={`Bugs, ${definition.libelle}`} className="colonne colonne-bugs">
        <div className="colonne-titre-bugs">
          <h3>{definition.libelle}</h3>
          {nombre > 0 && (
            <span className="compteur" aria-label={`${nombre} ${nombre > 1 ? 'bugs' : 'bug'}`}>
              {nombre}
            </span>
          )}
        </div>
        {corps}
      </section>
    );
  }

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
      {corps}
    </section>
  );
}
