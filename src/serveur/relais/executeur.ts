import type { Ticket } from '../../domaine/types';
import type { Projet, Run } from '../base/depots';

export interface DemandeRun {
  run: Run;
  ticket: Ticket;
  /** Projet du ticket : il porte le dépôt GitHub et les URL de préprod et de prod. */
  projet: Projet | null;
}

export interface ReponseLancement {
  /** URL de la session Claude Code renvoyée par /fire, quand elle existe. */
  urlSession?: string;
}

/**
 * Lance un run hors du serveur. La fin du run revient toujours par un webhook signé,
 * jamais par la valeur de retour : le relais traite le simulé et le réel de la même façon.
 */
export interface Executeur {
  lancer(demande: DemandeRun): Promise<ReponseLancement>;
}

export interface Executeurs {
  /** Rédaction de spec et boucle de dev : consomme le quota Claude. */
  claude: Executeur;
  /** Pipeline GitHub Actions de mise en prod : ne consomme pas de quota. */
  deploiement: Executeur;
}

export class QuotaAtteintErreur extends Error {
  constructor(readonly repriseEstimee: string | null) {
    super('Quota Claude atteint');
  }
}
