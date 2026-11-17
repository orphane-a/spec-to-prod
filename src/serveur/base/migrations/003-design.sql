-- Étape design en conception, et suivi des nouvelles des runs pour repérer une session silencieuse.
-- SQLite ne sait pas modifier une contrainte CHECK : les tables tickets et runs sont reconstruites.
-- Les clés étrangères sont coupées pendant les migrations (voir connexion.ts).

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
  run_en_cours TEXT CHECK (run_en_cours IN ('spec', 'design', 'dev', 'deploiement')),
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

INSERT INTO tickets_nouveau (id, titre, description, projet_id, colonne, bloque_motif, bloque_cause, bloque_le, reprise_estimee,
  run_en_cours, spec_markdown, spec_version, branche, iteration, iteration_max, controles_dev, etapes_deploiement,
  url_preprod, version_deployee, deploye_le, cree_le, modifie_le)
SELECT id, titre, description, projet_id, colonne, bloque_motif, bloque_cause, bloque_le, reprise_estimee,
  run_en_cours, spec_markdown, spec_version, branche, iteration, iteration_max, controles_dev, etapes_deploiement,
  url_preprod, version_deployee, deploye_le, cree_le, modifie_le
FROM tickets;

DROP TABLE tickets;
ALTER TABLE tickets_nouveau RENAME TO tickets;

CREATE TABLE runs_nouveau (
  id TEXT PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('spec', 'design', 'dev', 'deploiement')),
  statut TEXT NOT NULL CHECK (statut IN ('en_cours', 'termine', 'echoue', 'abandonne')),
  url_session TEXT,
  debut TEXT NOT NULL,
  derniere_nouvelle TEXT NOT NULL,
  fin TEXT
);

INSERT INTO runs_nouveau (id, ticket_id, type, statut, url_session, debut, derniere_nouvelle, fin)
SELECT id, ticket_id, type, statut, url_session, debut, debut, fin FROM runs;

DROP TABLE runs;
ALTER TABLE runs_nouveau RENAME TO runs;
CREATE INDEX runs_ticket ON runs(ticket_id);
CREATE INDEX runs_en_cours ON runs(statut, derniere_nouvelle);
