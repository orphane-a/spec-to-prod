import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DOSSIER_MIGRATIONS = fileURLToPath(new URL('./migrations/', import.meta.url));

export type Base = DatabaseSync;

/** Ouvre la base (':memory:' accepté) et applique les migrations manquantes. */
export function ouvrirBase(chemin: string): Base {
  if (chemin !== ':memory:') mkdirSync(dirname(chemin), { recursive: true });
  const base = new DatabaseSync(chemin);
  base.exec('PRAGMA foreign_keys = ON;');
  if (chemin !== ':memory:') base.exec('PRAGMA journal_mode = WAL;');
  migrer(base);
  return base;
}

function migrer(base: Base): void {
  const { user_version: versionActuelle } = base.prepare('PRAGMA user_version').get() as { user_version: number };
  const fichiers = readdirSync(DOSSIER_MIGRATIONS)
    .filter((f) => /^\d{3}-.+\.sql$/.test(f))
    .sort();
  for (const fichier of fichiers) {
    const version = Number(fichier.slice(0, 3));
    if (version <= versionActuelle) continue;
    const sql = readFileSync(DOSSIER_MIGRATIONS + fichier, 'utf8');
    enTransaction(base, () => {
      base.exec(sql);
      base.exec(`PRAGMA user_version = ${version};`);
    });
  }
}

export function enTransaction<T>(base: Base, travail: () => T): T {
  base.exec('BEGIN');
  try {
    const resultat = travail();
    base.exec('COMMIT');
    return resultat;
  } catch (erreur) {
    base.exec('ROLLBACK');
    throw erreur;
  }
}
