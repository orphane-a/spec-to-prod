import type { Executeur } from './executeur';

/**
 * Phase 2 : appel de l'endpoint /fire de la tâche cloud (jeton par tâche, côté serveur)
 * et du pipeline GitHub Actions. Jamais d'ANTHROPIC_API_KEY.
 */
export const executeurReel: Executeur = {
  async lancer() {
    throw new Error('le branchement réel sur les tâches cloud arrive en phase 2');
  },
};
