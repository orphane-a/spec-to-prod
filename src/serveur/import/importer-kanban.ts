/**
 * Importe dans la base les cartes exportées d'un ancien kanban en artefact.
 * Usage : npx tsx src/serveur/import/importer-kanban.ts <dossier des cartes JSON> "<nom du projet>" "<nom du kanban>"
 * Les cartes déjà présentes (même titre dans le projet) sont ignorées : relancer est sans risque.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ouvrirBase } from '../base/connexion';
import { creerDepots } from '../base/depots';
import { convertirCarte } from './kanban-artefact';

const [dossier, nomProjet, nomKanban = nomProjet] = process.argv.slice(2);
if (!dossier || !nomProjet) {
  console.error('Usage : importer-kanban.ts <dossier> "<projet>" ["<kanban>"]');
  process.exit(1);
}

const base = ouvrirBase(process.env.BASE_CHEMIN ?? 'donnees/spec-to-prod.db');
const depots = creerDepots(base, Number(process.env.ITERATIONS_MAX ?? 5));
const projet = depots.projets.parNom(nomProjet);
if (!projet) {
  console.error(`Projet introuvable : ${nomProjet}`);
  process.exit(1);
}

const bilan = { importes: 0, deja: 0, ignores: [] as string[] };
for (const fichier of readdirSync(dossier).filter((f) => f.endsWith('.json')).sort()) {
  const brut = JSON.parse(readFileSync(join(dossier, fichier), 'utf8'));
  const carte = brut.data && typeof brut.data === 'object' ? brut.data : brut;
  const ticket = convertirCarte(carte, nomKanban!, projet.urlPreprod);
  if (!ticket) {
    bilan.ignores.push(`${fichier} (${carte.deleted ? 'supprimée' : `colonne ${carte.status}`})`);
    continue;
  }
  if (depots.tickets.existeDansProjet(projet.id, ticket.titre)) {
    bilan.deja++;
    continue;
  }
  depots.tickets.importer(projet.id, ticket);
  bilan.importes++;
}

console.log(`${nomProjet} : ${bilan.importes} tickets importés, ${bilan.deja} déjà présents, ${bilan.ignores.length} ignorés.`);
if (bilan.ignores.length) console.log(`Ignorés : ${bilan.ignores.join(', ')}`);
base.close();
