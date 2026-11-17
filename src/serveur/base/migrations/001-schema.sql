CREATE TABLE projets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nom TEXT NOT NULL UNIQUE,
  depot TEXT,
  url_preprod TEXT,
  url_prod TEXT
);

CREATE TABLE tickets (
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
  run_en_cours TEXT CHECK (run_en_cours IN ('spec', 'dev', 'deploiement')),
  spec_markdown TEXT,
  spec_version INTEGER NOT NULL DEFAULT 0,
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

CREATE TABLE scenarios (
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  ordre INTEGER NOT NULL,
  objectif TEXT NOT NULL,
  etapes TEXT NOT NULL,
  resultat_attendu TEXT NOT NULL,
  fait INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ticket_id, ordre)
);

CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('spec', 'dev', 'deploiement')),
  statut TEXT NOT NULL CHECK (statut IN ('en_cours', 'termine', 'echoue', 'abandonne')),
  url_session TEXT,
  debut TEXT NOT NULL,
  fin TEXT
);
CREATE INDEX runs_ticket ON runs(ticket_id);

CREATE TABLE journal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  type TEXT NOT NULL,
  detail TEXT NOT NULL
);
CREATE INDEX journal_ticket ON journal(ticket_id, date);

CREATE TABLE quota (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  pourcentage_semaine INTEGER NOT NULL DEFAULT 0 CHECK (pourcentage_semaine BETWEEN 0 AND 100),
  epuise INTEGER NOT NULL DEFAULT 0,
  reprise_estimee TEXT,
  mis_a_jour_le TEXT NOT NULL
);
INSERT INTO quota (id, pourcentage_semaine, epuise, reprise_estimee, mis_a_jour_le)
VALUES (1, 0, 0, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT INTO projets (nom) VALUES ('AMLF'), ('Interface JDR');
