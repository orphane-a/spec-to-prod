import type { Projet, Quota } from '../api';
import { IconePlus, Logo } from './Icones';

interface Props {
  projets: Projet[];
  filtre: number | null;
  choisirFiltre: (projetId: number | null) => void;
  quota: Quota | null;
  ajouter: () => void;
}

export function Entete({ projets, filtre, choisirFiltre, quota, ajouter }: Props) {
  return (
    <header className="entete">
      <div className="marque">
        <Logo />
        <h1>Spec to prod</h1>
      </div>
      <div role="group" aria-label="Filtrer par projet" className="filtres">
        <button type="button" className="filtre" aria-pressed={filtre === null} onClick={() => choisirFiltre(null)}>
          Tous les projets
        </button>
        {projets.map((p) => (
          <button key={p.id} type="button" className="filtre" aria-pressed={filtre === p.id} onClick={() => choisirFiltre(p.id)}>
            {p.nom}
          </button>
        ))}
      </div>
      <div className="entete-droite">
        <JaugeQuota quota={quota} />
        <button type="button" className="bouton bouton-encre" onClick={ajouter}>
          <IconePlus />
          Ajouter un ticket
        </button>
      </div>
    </header>
  );
}

function JaugeQuota({ quota }: { quota: Quota | null }) {
  const pourcentage = quota?.pourcentageSemaine ?? 0;
  const libelle = quota === null ? 'Quota Claude de la semaine : inconnu' : quota.epuise ? 'Quota Claude de la semaine : épuisé' : `Quota Claude de la semaine : ${pourcentage} % utilisé`;
  return (
    <div className="jauge">
      <span className="jauge-libelle">{libelle}</span>
      <div role="img" aria-label={`${quota?.epuise ? 100 : pourcentage} pour cent du quota hebdomadaire utilisé`} className={`rail${quota?.epuise ? ' epuise' : ''}`}>
        <div style={{ width: `${quota?.epuise ? 100 : pourcentage}%` }} />
      </div>
    </div>
  );
}
