-- Étape préprod (run « preprod ») et branche principale de chaque projet.
-- SQLite ne sait pas modifier une contrainte CHECK : les tables tickets et runs sont reconstruites,
-- clés étrangères coupées (voir connexion.ts).

CREATE TABLE tickets_nouveau (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  titre TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  projet_id INTEGER REFERENCES projets(id),
  colonne TEXT NOT NULL DEFAULT 'backlog'
    CHECK (colonne IN ('backlog', 'conception', 'dev', 'test', 'deploiement', 'done')),
  bloque_motif TEXT,
  bloque_cause TEXT CHECK (bloque_cause IN ('echec', 'quota', 'iterations')),
  bloque_le TEXT,
  reprise_estimee TEXT,
  run_en_cours TEXT CHECK (run_en_cours IN ('spec', 'design', 'dev', 'preprod', 'deploiement')),
  spec_markdown TEXT,
  spec_version INTEGER NOT NULL DEFAULT 0,
  design_markdown TEXT,
  url_maquette TEXT,
  design_version INTEGER NOT NULL DEFAULT 0,
  branche TEXT,
  iteration INTEGER NOT NULL DEFAULT 0,
  iteration_max INTEGER NOT NULL,
  controles_dev TEXT NOT NULL,
  etapes_deploiement TEXT NOT NULL,
  url_preprod TEXT,
  version_deployee TEXT,
  deploye_le TEXT,
  cree_le TEXT NOT NULL,
  modifie_le TEXT NOT NULL
);

INSERT INTO tickets_nouveau SELECT * FROM tickets;

DROP TABLE tickets;
ALTER TABLE tickets_nouveau RENAME TO tickets;

CREATE TABLE runs_nouveau (
  id TEXT PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('spec', 'design', 'dev', 'preprod', 'deploiement')),
  statut TEXT NOT NULL CHECK (statut IN ('en_cours', 'termine', 'echoue', 'abandonne')),
  url_session TEXT,
  debut TEXT NOT NULL,
  derniere_nouvelle TEXT NOT NULL,
  fin TEXT
);

INSERT INTO runs_nouveau SELECT * FROM runs;

DROP TABLE runs;
ALTER TABLE runs_nouveau RENAME TO runs;
CREATE INDEX runs_ticket ON runs(ticket_id);
CREATE INDEX runs_en_cours ON runs(statut, derniere_nouvelle);

-- Branche sur laquelle chaque pipeline est lancé et vers laquelle la prod fusionne.
ALTER TABLE projets ADD COLUMN branche_principale TEXT NOT NULL DEFAULT 'main';
UPDATE projets SET branche_principale = 'master' WHERE depot = 'orphane-a/optivie';
