#!/usr/bin/env node
// Outil des pipelines GitHub Actions des projets pilotés par Spec to prod.
//
//   node pipeline.mjs signaler <TYPE> ['{"champ": "valeur"}']
//       Envoie l'événement au kanban. Variables : WEBHOOK, RUN_ID, SPEC_TO_PROD_SECRET,
//       et SPEC_TO_PROD_URL qui, si elle est définie, doit préfixer WEBHOOK.
//
//   node pipeline.mjs attendre <url> <version> [--champ commit] [--minutes 25]
//       Interroge l'URL jusqu'à ce qu'elle affiche la version attendue : le texte brut
//       de la réponse, ou le champ JSON donné par --champ. Une version courte (7 caractères)
//       suffit à reconnaître un commit complet, et inversement.
//
// Aucune dépendance : Node 20 ou plus.

import { pathToFileURL } from 'node:url';
import { envoyer } from './signaler.mjs';

const attendreMs = (ms) => new Promise((r) => setTimeout(r, ms));

export function memeVersion(lue, attendue) {
  const a = String(lue ?? '').trim();
  const b = String(attendue ?? '').trim();
  if (a.length < 7 || b.length < 7) return a !== '' && a === b;
  return a.startsWith(b) || b.startsWith(a);
}

export function construireCorps(runId, type, champs = {}) {
  return { runId, evenement: { type, ...champs } };
}

export async function signaler(type, champs, env = process.env, options) {
  const { WEBHOOK, RUN_ID, SPEC_TO_PROD_SECRET, SPEC_TO_PROD_URL } = env;
  if (!WEBHOOK || !RUN_ID || !SPEC_TO_PROD_SECRET) throw new Error('WEBHOOK, RUN_ID et SPEC_TO_PROD_SECRET sont obligatoires.');
  if (SPEC_TO_PROD_URL && !WEBHOOK.startsWith(SPEC_TO_PROD_URL.replace(/\/?$/, '/'))) {
    throw new Error(`Webhook refusé : il doit commencer par ${SPEC_TO_PROD_URL}.`);
  }
  const resultat = await envoyer(WEBHOOK, construireCorps(RUN_ID, type, champs), SPEC_TO_PROD_SECRET, options);
  if (!resultat.ok) throw new Error(`Signalement ${type} refusé (statut ${resultat.statut}) : ${resultat.texte}`);
  return resultat;
}

/** Version affichée par l'URL : texte brut, ou champ d'une réponse JSON. */
async function lireVersion(url, champ, fetcher) {
  const separateur = url.includes('?') ? '&' : '?';
  const reponse = await fetcher(`${url}${separateur}t=${Date.now()}`, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(15_000) });
  if (!reponse.ok) return null;
  const texte = await reponse.text();
  if (!champ) return texte;
  try {
    return JSON.parse(texte)?.[champ] ?? null;
  } catch {
    return null;
  }
}

export async function attendreVersion(url, attendue, { champ, minutes = 25, pauseMs = 15_000, fetcher = fetch, journal = console.log } = {}) {
  const limite = Date.now() + minutes * 60_000;
  let derniere;
  for (;;) {
    try {
      derniere = await lireVersion(url, champ, fetcher);
    } catch {
      derniere = null;
    }
    if (memeVersion(derniere, attendue)) return { ok: true, version: derniere };
    if (Date.now() + pauseMs > limite) return { ok: false, version: derniere };
    journal(`En attente de la version ${attendue} sur ${url}, version lue : ${derniere ?? 'aucune'}.`);
    await attendreMs(pauseMs);
  }
}

function option(args, nom, defaut) {
  const i = args.indexOf(nom);
  return i >= 0 ? args[i + 1] : defaut;
}

async function principal([commande, ...args]) {
  if (commande === 'signaler') {
    const [type, json] = args;
    if (!type) throw new Error('Usage : node pipeline.mjs signaler <TYPE> [json]');
    await signaler(type, json ? JSON.parse(json) : {});
    console.log(`Signalé : ${type}`);
    return 0;
  }
  if (commande === 'attendre') {
    const [url, version] = args;
    if (!url || !version) throw new Error('Usage : node pipeline.mjs attendre <url> <version> [--champ commit] [--minutes 25]');
    const r = await attendreVersion(url, version, { champ: option(args, '--champ'), minutes: Number(option(args, '--minutes', '25')) });
    if (r.ok) {
      console.log(`Version ${version} en ligne sur ${url}.`);
      return 0;
    }
    console.error(`La version ${version} n'est pas apparue sur ${url}. Dernière version lue : ${r.version ?? 'aucune'}.`);
    return 1;
  }
  throw new Error('Commandes : signaler, attendre.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = await principal(process.argv.slice(2));
  } catch (erreur) {
    console.error(erreur instanceof Error ? erreur.message : String(erreur));
    process.exitCode = 2;
  }
}
