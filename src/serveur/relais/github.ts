import type { Projet } from '../base/depots';
import type { DemandeRun, Executeur, ReponseLancement } from './executeur';
import { SOURCES } from './webhooks';

/**
 * Préprod et prod : Spec to prod lance le pipeline GitHub Actions du projet
 * (.github/workflows/spec-to-prod.yml, déclencheur workflow_dispatch).
 * Le pipeline déploie avec ses propres secrets, puis signale sa fin au webhook signé.
 * Le serveur ne garde qu'un jeton GitHub à droits fins, limité au lancement des pipelines.
 */

export const FICHIER_PIPELINE = 'spec-to-prod.yml';
export const VERSION_API_GITHUB = '2022-11-28';

export interface OptionsExecuteurPipeline {
  jeton: string;
  /** Adresse publique du relais, joignable depuis GitHub Actions. */
  urlRelais: string;
  fetch?: typeof fetch;
  delaiMs?: number;
}

/** Entrées du workflow_dispatch : uniquement des chaînes, comme l'exige GitHub. */
export function entreesPipeline({ run, ticket }: DemandeRun, urlRelais: string): Record<string, string> {
  return {
    environnement: run.type === 'preprod' ? 'preprod' : 'prod',
    branche: ticket.branche!,
    ticket: String(ticket.id),
    run_id: run.id,
    webhook: new URL(SOURCES.pipeline.chemin, urlRelais).toString(),
  };
}

export function creerExecuteurPipeline(options: OptionsExecuteurPipeline): Executeur {
  const envoyer = options.fetch ?? fetch;
  const delaiMs = options.delaiMs ?? 30_000;

  return {
    async lancer(demande: DemandeRun): Promise<ReponseLancement> {
      const { run, ticket, projet } = demande;
      if (run.type !== 'preprod' && run.type !== 'deploiement') throw new Error('seuls la préprod et la prod passent par le pipeline du projet.');
      verifierProjet(projet);
      if (!ticket.branche) throw new Error('ce ticket n’a pas de branche à déployer.');

      const url = `https://api.github.com/repos/${projet.depot}/actions/workflows/${FICHIER_PIPELINE}/dispatches`;
      let reponse: Response;
      try {
        reponse = await envoyer(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${options.jeton}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': VERSION_API_GITHUB,
            'User-Agent': 'spec-to-prod',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ref: projet.branchePrincipale, inputs: entreesPipeline(demande, options.urlRelais) }),
          signal: AbortSignal.timeout(delaiMs),
        });
      } catch (erreur) {
        // Pas de nouvel essai automatique : un doublon lancerait deux déploiements.
        throw new Error('GitHub est injoignable. Vérifiez l’onglet Actions du dépôt avant de relancer.', { cause: erreur });
      }

      if (!reponse.ok) throw new Error(await messageErreur(reponse, projet));
      return { urlSession: `https://github.com/${projet.depot}/actions/workflows/${FICHIER_PIPELINE}` };
    },
  };
}

function verifierProjet(projet: Projet | null): asserts projet is Projet & { depot: string } {
  if (!projet) throw new Error('ce ticket n’est rattaché à aucun projet, donc à aucun pipeline.');
  if (!projet.depot) throw new Error(`le projet ${projet.nom} n’a pas de dépôt GitHub.`);
}

async function messageErreur(reponse: Response, projet: Projet & { depot: string }): Promise<string> {
  const corps = (await reponse.json().catch(() => null)) as { message?: unknown } | null;
  const detail = typeof corps?.message === 'string' ? ` Détail : ${corps.message.slice(0, 300)}` : '';
  const messages: Record<number, string> = {
    401: 'le jeton GitHub est refusé. Générez un nouveau jeton et mettez à jour le fichier .env du serveur.',
    403: `le jeton GitHub n’a pas le droit de lancer les pipelines de ${projet.depot} (droit Actions en écriture).`,
    404: `pipeline introuvable : ${FICHIER_PIPELINE} doit être présent sur la branche ${projet.branchePrincipale} de ${projet.depot}.`,
    422: `GitHub refuse le lancement : le pipeline ${FICHIER_PIPELINE} doit accepter workflow_dispatch avec les bonnes entrées.`,
  };
  return (messages[reponse.status] ?? `GitHub a répondu ${reponse.status}.`) + detail;
}
