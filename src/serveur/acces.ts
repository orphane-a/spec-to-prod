import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ErreurMetier } from './erreurs';

/**
 * Accès au tableau par un mot de passe unique : Spec to prod sert une seule personne.
 * Une connexion réussie pose un cookie de session signé, HttpOnly, SameSite=Strict.
 * Les webhooks du relais n'en ont pas besoin : ils sont signés par le secret partagé.
 */

export const NOM_COOKIE = 'stp_session';
export const DUREE_SESSION_MS = 30 * 24 * 3600_000;
const ESSAIS_MAX = 5;
const FENETRE_ESSAIS_MS = 15 * 60_000;

/** Chemins de l'API ouverts sans session. */
const CHEMINS_PUBLICS = new Set(['/api/sante', '/api/session', '/api/connexion', '/api/deconnexion']);

export interface OptionsAcces {
  /** Absent : tableau ouvert, réservé à un serveur qui n'écoute qu'en local. */
  motDePasse: string | undefined;
  /** Secret serveur dont dérive la clé des sessions. */
  secret: string;
  maintenant?: () => number;
}

const empreinte = (texte: string) => createHash('sha256').update(texte, 'utf8').digest();

/** Comparaison à temps constant, quelle que soit la longueur. */
export function memeMotDePasse(saisi: string, attendu: string): boolean {
  return timingSafeEqual(empreinte(saisi), empreinte(attendu));
}

/** Changer le mot de passe invalide toutes les sessions ouvertes. */
function cleSession(options: OptionsAcces): Buffer {
  return createHmac('sha256', options.secret).update(`session:${empreinte(options.motDePasse ?? '').toString('hex')}`).digest();
}

export function creerJeton(expiration: number, cle: Buffer): string {
  return `${expiration}.${createHmac('sha256', cle).update(String(expiration)).digest('hex')}`;
}

export function jetonValide(jeton: string | undefined, cle: Buffer, maintenant: number): boolean {
  if (!jeton) return false;
  const [brut, signature] = jeton.split('.');
  const expiration = Number(brut);
  if (!signature || !Number.isInteger(expiration) || expiration <= maintenant) return false;
  const attendu = Buffer.from(creerJeton(expiration, cle));
  const recu = Buffer.from(jeton);
  return attendu.length === recu.length && timingSafeEqual(attendu, recu);
}

export function lireCookie(entete: string | undefined, nom: string): string | undefined {
  for (const morceau of (entete ?? '').split(';')) {
    const [cle, ...valeur] = morceau.trim().split('=');
    if (cle === nom) return decodeURIComponent(valeur.join('='));
  }
  return undefined;
}

function cookie(requete: FastifyRequest, valeur: string, maxAgeSecondes: number): string {
  const securise = requete.protocol === 'https' ? '; Secure' : '';
  return `${NOM_COOKIE}=${encodeURIComponent(valeur)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSecondes}${securise}`;
}

export function enregistrerAcces(app: FastifyInstance, options: OptionsAcces): void {
  const maintenant = options.maintenant ?? Date.now;
  const protege = Boolean(options.motDePasse);
  const cle = cleSession(options);
  const echecs = new Map<string, number[]>();

  const connecte = (requete: FastifyRequest) => !protege || jetonValide(lireCookie(requete.headers.cookie, NOM_COOKIE), cle, maintenant());

  app.addHook('onRequest', async (requete: FastifyRequest, reponse: FastifyReply) => {
    const chemin = requete.url.split('?')[0]!;
    if (!protege || !chemin.startsWith('/api/') || CHEMINS_PUBLICS.has(chemin)) return;
    if (!connecte(requete)) {
      return reponse.code(401).send({ code: 'NON_CONNECTE', message: 'Connectez vous pour continuer.' });
    }
  });

  app.get('/api/session', async (requete) => ({ protege, connecte: connecte(requete) }));

  app.post('/api/connexion', async (requete, reponse) => {
    if (!protege) return reponse.code(204).send();
    const ip = requete.ip;
    const recents = (echecs.get(ip) ?? []).filter((t) => t > maintenant() - FENETRE_ESSAIS_MS);
    if (recents.length >= ESSAIS_MAX) {
      throw new ErreurMetier(429, 'TROP_D_ESSAIS', 'Trop d’essais. Réessayez dans un quart d’heure.');
    }
    const { motDePasse } = z.object({ motDePasse: z.string().max(200) }).parse(requete.body ?? {});
    if (!memeMotDePasse(motDePasse, options.motDePasse!)) {
      echecs.set(ip, [...recents, maintenant()]);
      throw new ErreurMetier(401, 'MOT_DE_PASSE_INCORRECT', 'Mot de passe incorrect.');
    }
    echecs.delete(ip);
    const jeton = creerJeton(maintenant() + DUREE_SESSION_MS, cle);
    return reponse.header('set-cookie', cookie(requete, jeton, DUREE_SESSION_MS / 1000)).code(204).send();
  });

  app.post('/api/deconnexion', async (requete, reponse) => reponse.header('set-cookie', cookie(requete, '', 0)).code(204).send());
}
