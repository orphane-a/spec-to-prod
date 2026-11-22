-- Ligne Bugs : un ticket est une fonctionnalité ou un bug. Un bug se corrige sans phase de spec.
-- L'origine dit qui l'a signalé : l'utilisatrice, ou l'agent de test exploratoire pendant le dev d'un autre ticket.
ALTER TABLE tickets ADD COLUMN nature TEXT NOT NULL DEFAULT 'fonctionnalite' CHECK (nature IN ('fonctionnalite', 'bug'));
ALTER TABLE tickets ADD COLUMN origine TEXT NOT NULL DEFAULT 'utilisatrice' CHECK (origine IN ('utilisatrice', 'agent'));
ALTER TABLE tickets ADD COLUMN trouve_sur INTEGER REFERENCES tickets(id) ON DELETE SET NULL;
