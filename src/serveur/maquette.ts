import type { Ticket } from '../domaine/types';
import { VERSION_API_GITHUB } from './relais/github';

/**
 * Aperçu de la maquette d'un ticket. La session de design commite un fichier HTML autonome
 * sur la branche du ticket et transmet son lien GitHub (page « blob »), qui n'affiche que le code.
 * Le serveur récupère le fichier brut, avec le jeton GitHub qui reste côté serveur,
 * et le sert dans un bac à sable : origine opaque, aucune requête réseau, aucun accès au tableau.
 */

export const HOTE_MAQUETTE_SIMULEE = 'maquette.exemple.test';

/** Politique appliquée à la maquette servie : isolée du tableau, sans aucune sortie réseau. */
export const POLITIQUE_MAQUETTE = [
  'sandbox allow-scripts',
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline'",
  'img-src data:',
  'font-src data:',
  "frame-ancestors 'self'",
].join('; ');

export interface EmplacementMaquette {
  depot: string;
  branche: string;
  chemin: string;
}

export class ErreurMaquette extends Error {}

/**
 * Lit https://github.com/<proprio>/<depot>/blob/<branche>/<chemin>.
 * Une branche peut contenir des barres obliques : on s'appuie sur celle du ticket quand elle est connue.
 */
export function emplacementMaquette(url: string, brancheTicket: string | null): EmplacementMaquette | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.hostname !== 'github.com') return null;
  const morceaux = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const [proprio, depot, blob, ...reste] = morceaux;
  if (!proprio || !depot || blob !== 'blob' || reste.length < 2) return null;
  const apres = reste.join('/');
  const branche = brancheTicket && apres.startsWith(`${brancheTicket}/`) ? brancheTicket : reste[0]!;
  const chemin = apres.slice(branche.length + 1);
  if (!chemin || chemin.split('/').includes('..')) return null;
  return { depot: `${proprio}/${depot}`, branche, chemin };
}

export interface OptionsLecteurMaquette {
  /** Jeton GitHub à droits fins, droit Contents en lecture. Facultatif pour un dépôt public. */
  jeton?: string;
  fetch?: typeof fetch;
  delaiMs?: number;
}

export type LecteurMaquette = (ticket: Ticket) => Promise<string>;

const TAILLE_MAX = 5 * 1024 * 1024;

export function creerLecteurMaquette(options: OptionsLecteurMaquette = {}): LecteurMaquette {
  const envoyer = options.fetch ?? fetch;
  const delaiMs = options.delaiMs ?? 15_000;

  return async (ticket) => {
    const url = ticket.urlMaquette;
    if (!url) throw new ErreurMaquette('Ce ticket n’a pas encore de maquette.');
    if (new URL(url).hostname === HOTE_MAQUETTE_SIMULEE) return maquetteSimulee(ticket);

    const emplacement = emplacementMaquette(url, ticket.branche);
    if (!emplacement) throw new ErreurMaquette('Le lien de la maquette n’est pas un fichier GitHub lisible.');
    const { depot, branche, chemin } = emplacement;
    const api = `https://api.github.com/repos/${depot}/contents/${chemin.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branche)}`;

    let reponse: Response;
    try {
      reponse = await envoyer(api, {
        headers: {
          ...(options.jeton ? { Authorization: `Bearer ${options.jeton}` } : {}),
          Accept: 'application/vnd.github.raw+json',
          'X-GitHub-Api-Version': VERSION_API_GITHUB,
          'User-Agent': 'spec-to-prod',
        },
        signal: AbortSignal.timeout(delaiMs),
      });
    } catch (erreur) {
      throw new ErreurMaquette('GitHub est injoignable pour l’instant. Réessayez dans un moment.', { cause: erreur });
    }

    if (!reponse.ok) {
      const messages: Record<number, string> = {
        401: 'Le jeton GitHub est refusé. Mettez à jour GITHUB_JETON sur le serveur.',
        403: `Le jeton GitHub n’a pas le droit de lire ${depot} (droit Contents en lecture).`,
        404: `Maquette introuvable : ${chemin} sur la branche ${branche} de ${depot}. Si le dépôt est privé, le jeton GitHub doit avoir le droit Contents en lecture.`,
      };
      throw new ErreurMaquette(messages[reponse.status] ?? `GitHub a répondu ${reponse.status}.`);
    }
    const html = await reponse.text();
    if (html.length > TAILLE_MAX) throw new ErreurMaquette('La maquette est trop lourde pour être affichée ici.');
    return html;
  };
}

function echapper(texte: string): string {
  return texte.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Page d'explication affichée dans le cadre de l'aperçu quand la maquette est indisponible. */
export function pageErreurMaquette(message: string): string {
  return `<!doctype html><html lang="fr"><meta charset="utf-8"><title>Maquette indisponible</title>
<style>body{font-family:system-ui,sans-serif;margin:0;padding:32px;color:#3b3b3b;background:#faf9f7;line-height:1.5}p{max-width:520px}</style>
<p><strong>La maquette ne peut pas s’afficher.</strong></p><p>${echapper(message)}</p></html>`;
}

/** Maquette du mode simulé : le faux Claude ne commite rien, on fabrique une page de démonstration. */
function maquetteSimulee(ticket: Ticket): string {
  const titre = echapper(ticket.titre);
  return `<!doctype html><html lang="fr"><meta charset="utf-8"><title>Maquette : ${titre}</title>
<style>
body{font-family:system-ui,sans-serif;margin:0;padding:32px;background:#f4f2ee;color:#2b2b2b}
h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:32px 0 12px;color:#6b6b6b;font-weight:600}
.ecran{background:#fff;border-radius:12px;padding:24px;max-width:520px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
label{display:block;font-size:14px;margin-bottom:6px}input{width:100%;box-sizing:border-box;padding:10px;border:1px solid #ccc;border-radius:8px;font:inherit}
.erreur input{border-color:#c0392b}.erreur small{color:#c0392b;display:block;margin-top:6px}
button{margin-top:16px;background:#2b2b2b;color:#fff;border:0;border-radius:8px;padding:10px 16px;font:inherit}
.note{font-size:13px;color:#6b6b6b}
</style>
<h1>${titre}</h1><p class="note">Maquette conçue par le faux Claude du mode simulé.</p>
<h2>Écran principal</h2><div class="ecran"><label>Votre saisie</label><input value="Exemple"><button>Valider</button></div>
<h2>État d’erreur</h2><div class="ecran erreur"><label>Votre saisie</label><input><small>Ce champ est obligatoire.</small><button>Valider</button></div>
</html>`;
}
