import { tachesCloud, type Config } from '../config';
import type { Executeurs } from './executeur';
import { creerExecuteurPipeline } from './github';
import { creerExecuteurReel } from './reel';
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

/** En mode reel, rien n'est jamais simulé : sessions Claude et pipelines GitHub sont les vrais. */
export function creerExecuteurs(config: Config, envoyer: Envoyer, journaliser: (m: string) => void): { executeurs: Executeurs; arreter: () => void } {
  if (config.CLAUDE_MODE === 'reel') {
    const urlRelais = config.RELAIS_URL_PUBLIQUE!;
    const claude = creerExecuteurReel({ taches: tachesCloud(config), urlRelais });
    const deploiement = creerExecuteurPipeline({ jeton: config.GITHUB_JETON!, urlRelais });
    return { executeurs: { claude, deploiement }, arreter: () => {} };
  }
  const simulation = new Simulation({ delaiMs: config.SIMULATION_DELAI_MS, envoyer, journaliser });
  return { executeurs: { claude: simulation.claude, deploiement: simulation.deploiement }, arreter: () => simulation.arreter() };
}
