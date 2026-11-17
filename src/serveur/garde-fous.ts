/**
 * Règle n°1 du projet : aucun appel à l'API Claude payante.
 * Si ANTHROPIC_API_KEY est présente, Claude Code facturerait l'API au lieu de l'abonnement.
 * Le serveur refuse donc de démarrer dans ce cas.
 */
export const VARIABLES_INTERDITES = ['ANTHROPIC_API_KEY'] as const;

export class ConfigurationInterditeErreur extends Error {}

export function verifierEnvironnement(env: NodeJS.ProcessEnv): void {
  for (const nom of VARIABLES_INTERDITES) {
    if (env[nom] !== undefined) {
      throw new ConfigurationInterditeErreur(
        `La variable ${nom} est définie. Spec to prod n'utilise jamais l'API Claude payante : retirez la de l'environnement.`,
      );
    }
  }
}
