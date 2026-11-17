#!/usr/bin/env node
// Signale l'avancement d'un run au relais Spec to prod, depuis une session Claude Code cloud.
//
// Usage : node taches-cloud/signaler.mjs <url-du-webhook> <fichier.json>
//
// Le fichier contient { "runId": "...", "evenement": { "type": "...", ... } }.
// Le corps est signé en HMAC SHA 256 avec la variable d'environnement SPEC_TO_PROD_SECRET,
// définie dans l'environnement cloud. Aucune dépendance : Node 20 ou plus suffit.

import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const ENTETE_SIGNATURE = 'x-signature';

export function signer(corps, secret) {
  return `sha256=${createHmac('sha256', secret).update(corps, 'utf8').digest('hex')}`;
}

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Envoie le corps signé. Le relais ignore les doublons, donc un nouvel essai est sans risque
 * après une coupure réseau ou une erreur 5xx. Une erreur 4xx est définitive.
 */
export async function envoyer(url, corps, secret, { essais = 4, pauseMs = 2000 } = {}) {
  const brut = JSON.stringify(corps);
  const entetes = { 'Content-Type': 'application/json', [ENTETE_SIGNATURE]: signer(brut, secret) };
  let derniere = '';
  for (let essai = 1; essai <= essais; essai++) {
    try {
      const reponse = await fetch(url, { method: 'POST', headers: entetes, body: brut, signal: AbortSignal.timeout(20_000) });
      const texte = await reponse.text();
      if (reponse.ok) return { ok: true, statut: reponse.status, texte };
      derniere = `statut ${reponse.status} : ${texte}`;
      if (reponse.status < 500) return { ok: false, statut: reponse.status, texte };
    } catch (erreur) {
      derniere = erreur instanceof Error ? erreur.message : String(erreur);
    }
    if (essai < essais) await attendre(pauseMs * essai);
  }
  return { ok: false, statut: 0, texte: derniere };
}

async function principal(argv) {
  const [url, fichier] = argv;
  const secret = process.env.SPEC_TO_PROD_SECRET;
  if (!url || !fichier) {
    console.error('Usage : node taches-cloud/signaler.mjs <url-du-webhook> <fichier.json>');
    return 2;
  }
  if (!secret) {
    console.error('SPEC_TO_PROD_SECRET est absente : ajoutez la dans les variables de l’environnement cloud.');
    return 2;
  }
  let corps;
  try {
    corps = JSON.parse(readFileSync(fichier, 'utf8'));
  } catch (erreur) {
    console.error(`Fichier illisible ou JSON invalide : ${erreur instanceof Error ? erreur.message : erreur}`);
    return 2;
  }
  if (typeof corps?.runId !== 'string' || typeof corps?.evenement?.type !== 'string') {
    console.error('Le fichier doit contenir runId et evenement.type.');
    return 2;
  }
  const resultat = await envoyer(url, corps, secret);
  console.log(resultat.ok ? `Signalé (${resultat.statut}) : ${resultat.texte}` : `Échec du signalement, ${resultat.texte}`);
  return resultat.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await principal(process.argv.slice(2));
}
