import { tachesCloud, type Config } from '../config';
import type { Executeur, Executeurs } from './executeur';
import { creerExecuteurReel } from './reel';

/** Le pipeline de mise en prod sera branché dans une tâche suivante. En mode reel, rien n'est jamais simulé. */
const deploiementNonBranche: Executeur = {
  async lancer() {
    throw new Error('le pipeline de mise en prod n’est pas encore branché.');
  },
};
import { Simulation, type Envoyer } from './simule';
import { ENTETE_SIGNATURE, signer } from './signature';

/** Envoi HTTP signé vers le relais lui même, comme le ferait une vraie session. */
export function envoyerParHttp(urlBase: string, secret: string): Envoyer {
  return async (chemin, corps) => {
    const brut = JSON.stringify(corps);
    const reponse = await fetch(new URL(chemin, urlBase), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [ENTETE_SIGNATURE]: signer(brut, secret) },
      body: brut,
    });
    if (!reponse.ok) throw new Error(`statut ${reponse.status} : ${await reponse.text()}`);
  };
}

export function creerExecuteurs(config: Config, envoyer: Envoyer, journaliser: (m: string) => void): { executeurs: Executeurs; arreter: () => void } {
  if (config.CLAUDE_MODE === 'reel') {
    const claude = creerExecuteurReel({ taches: tachesCloud(config), urlRelais: config.RELAIS_URL_PUBLIQUE! });
    return { executeurs: { claude, deploiement: deploiementNonBranche }, arreter: () => {} };
  }
  const simulation = new Simulation({ delaiMs: config.SIMULATION_DELAI_MS, envoyer, journaliser });
  return { executeurs: { claude: simulation.claude, deploiement: simulation.deploiement }, arreter: () => simulation.arreter() };
}
