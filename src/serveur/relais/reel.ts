import type { Projet } from '../base/depots';
import { commentairesATransmettre } from '../../domaine/commentaires';
import { CHEMIN_BUG, SOURCES } from './webhooks';
import { QuotaAtteintErreur, type DemandeRun, type Executeur, type ReponseLancement } from './executeur';

/**
 * Branchement réel : chaque étape Claude (spec, design, dev) est une tâche cloud
 * déclenchée par son endpoint /fire, avec son propre jeton gardé côté serveur.
 * La session consomme le quota de l'abonnement, jamais l'API payante.
 * Sa fin revient par le webhook signé, comme en mode simulé.
 */

export type EtapeClaude = 'spec' | 'design' | 'dev';

export interface TacheCloud {
  /** URL complète de l'endpoint, par exemple https://api.anthropic.com/v1/claude_code/routines/trig_.../fire */
  url: string;
  jeton: string;
}

export interface OptionsExecuteurReel {
  taches: Record<EtapeClaude, TacheCloud>;
  /** Adresse publique du relais, joignable depuis l'environnement cloud. */
  urlRelais: string;
  fetch?: typeof fetch;
  delaiMs?: number;
  maintenant?: () => number;
}

/** Taille maximale du champ text accepté par /fire. */
export const TAILLE_MAX_TEXTE = 65_536;
export const VERSION_ANTHROPIC = '2023-06-01';
export const BETA_ROUTINES = 'experimental-cc-routine-2026-04-01';

const CONSIGNES: Record<EtapeClaude, string> = {
  spec: 'Rédige la spec du ticket en markdown, en français, en tenant compte de ses commentaires, puis signale SPEC_PRETE.',
  design: 'Conçois la maquette HTML du ticket à partir de sa spec et de ses commentaires, commite la sur la branche du ticket, puis signale DESIGN_PRET.',
  dev: 'Développe le ticket sur sa branche à partir de la spec, de la maquette et de ses commentaires, avec la boucle de tests, puis signale DEV_TERMINE.',
};

const CONSIGNE_BUG =
  'Corrige le bug décrit dans la description du ticket, sur une nouvelle branche : écris d’abord un test qui le reproduit, puis corrige avec la boucle de tests, puis signale DEV_TERMINE.';

/** Charge utile transmise à la session. Elle est lue comme une donnée par le prompt enregistré de la tâche. */
export function construireCharge({ run, ticket, projet }: DemandeRun, urlRelais: string) {
  const etape = run.type as EtapeClaude;
  return {
    version: 1,
    etape,
    consigne: etape === 'dev' && ticket.nature === 'bug' ? CONSIGNE_BUG : CONSIGNES[etape],
    runId: run.id,
    ticket: {
      id: ticket.id,
      nature: ticket.nature,
      titre: ticket.titre,
      description: ticket.description,
      branche: ticket.branche,
      ...(etape !== 'spec' ? { spec: ticket.spec } : {}),
      // Retours de l'utilisatrice encore en attente pour cette étape.
      commentaires: commentairesATransmettre(ticket, etape).map(({ sujet, texte, creeLe }) => ({ sujet, texte, le: creeLe })),
      ...(etape === 'dev' ? { design: ticket.design, urlMaquette: ticket.urlMaquette, iterationMax: ticket.iterationMax } : {}),
    },
    projet: { nom: projet!.nom, depot: projet!.depot, urlPreprod: projet!.urlPreprod },
    relais: {
      webhook: new URL(SOURCES.claude.chemin, urlRelais).toString(),
      // Bugs hors périmètre trouvés par le test exploratoire du dev.
      ...(etape === 'dev' ? { webhookBug: new URL(CHEMIN_BUG, urlRelais).toString() } : {}),
      script: 'taches-cloud/signaler.mjs, dans le dépôt orphane-a/spec-to-prod',
    },
  };
}

export function creerExecuteurReel(options: OptionsExecuteurReel): Executeur {
  const envoyer = options.fetch ?? fetch;
  const delaiMs = options.delaiMs ?? 30_000;
  const maintenant = options.maintenant ?? Date.now;

  return {
    async lancer(demande: DemandeRun): Promise<ReponseLancement> {
      const { run, projet } = demande;
      if (run.type === 'preprod' || run.type === 'deploiement') throw new Error('les déploiements passent par GitHub Actions, pas par une tâche Claude.');
      verifierProjet(projet);

      const texte = JSON.stringify(construireCharge(demande, options.urlRelais), null, 2);
      if (texte.length > TAILLE_MAX_TEXTE) {
        throw new Error(`la demande fait ${texte.length} caractères, au delà des ${TAILLE_MAX_TEXTE} acceptés par la tâche cloud. Raccourcissez la spec ou le design.`);
      }

      const tache = options.taches[run.type];
      let reponse: Response;
      try {
        reponse = await envoyer(tache.url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${tache.jeton}`,
            'anthropic-version': VERSION_ANTHROPIC,
            'anthropic-beta': BETA_ROUTINES,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ text: texte }),
          signal: AbortSignal.timeout(delaiMs),
        });
      } catch (erreur) {
        const expire = erreur instanceof Error && (erreur.name === 'TimeoutError' || erreur.name === 'AbortError');
        // Pas de nouvel essai automatique : /fire n'est pas idempotent, un doublon lancerait deux sessions.
        throw new Error(
          expire ? 'la tâche cloud ne répond pas. Vérifiez sur claude.ai qu’aucune session n’a démarré avant de relancer.' : 'la tâche cloud est injoignable.',
          { cause: erreur },
        );
      }

      if (reponse.status === 429) {
        throw new QuotaAtteintErreur(repriseDepuis(reponse.headers.get('retry-after'), maintenant()));
      }
      if (!reponse.ok) throw new Error(await messageErreur(reponse));

      const corps = (await reponse.json().catch(() => ({}))) as { claude_code_session_url?: unknown };
      const urlSession = typeof corps.claude_code_session_url === 'string' ? corps.claude_code_session_url : undefined;
      return urlSession ? { urlSession } : {};
    },
  };
}

function verifierProjet(projet: Projet | null): asserts projet is Projet & { depot: string } {
  if (!projet) throw new Error('ce ticket n’est rattaché à aucun projet, donc à aucun dépôt GitHub.');
  if (!projet.depot) throw new Error(`le projet ${projet.nom} n’a pas de dépôt GitHub.`);
}

/** Retry-After en secondes ou en date HTTP. */
export function repriseDepuis(entete: string | null, maintenant: number): string | null {
  if (!entete) return null;
  const secondes = Number(entete);
  if (Number.isFinite(secondes) && secondes >= 0) return new Date(maintenant + secondes * 1000).toISOString();
  const date = Date.parse(entete);
  return Number.isNaN(date) ? null : new Date(date).toISOString();
}

const MESSAGES: Record<number, string> = {
  400: 'la tâche cloud a refusé la demande. Elle est peut être en pause sur claude.ai.',
  401: 'le jeton de la tâche cloud est refusé. Générez un nouveau jeton sur claude.ai et mettez à jour le fichier .env du serveur.',
  403: 'ce compte n’a pas accès aux tâches cloud déclenchées par API.',
  404: 'la tâche cloud est introuvable. Vérifiez son URL dans le fichier .env du serveur.',
  500: 'le service des tâches cloud est en erreur.',
  503: 'le service des tâches cloud est surchargé. Relancez dans quelques minutes.',
};

async function messageErreur(reponse: Response): Promise<string> {
  const base = MESSAGES[reponse.status] ?? `la tâche cloud a répondu ${reponse.status}.`;
  const corps = (await reponse.json().catch(() => null)) as { error?: { message?: unknown } } | null;
  const detail = typeof corps?.error?.message === 'string' ? corps.error.message.slice(0, 300) : null;
  return detail ? `${base} Détail : ${detail}` : base;
}
