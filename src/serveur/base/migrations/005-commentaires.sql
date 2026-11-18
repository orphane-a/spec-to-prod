-- Commentaires d'un ticket : retours sur la spec, le design ou les tests, transmis à Claude au prochain run concerné.
CREATE TABLE commentaires (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  sujet TEXT NOT NULL CHECK (sujet IN ('general', 'spec', 'design', 'tests')),
  texte TEXT NOT NULL,
  cree_le TEXT NOT NULL,
  pris_en_compte_le TEXT
);
CREATE INDEX commentaires_ticket ON commentaires(ticket_id, id);
