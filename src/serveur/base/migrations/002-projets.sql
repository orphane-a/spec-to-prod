-- Retire le projet AMLF (et ses tickets de démonstration), ajoute Optivie et Demandez le programme.
DELETE FROM tickets WHERE projet_id IN (SELECT id FROM projets WHERE nom = 'AMLF');
DELETE FROM projets WHERE nom = 'AMLF';

INSERT INTO projets (nom, depot, url_preprod, url_prod) VALUES
  ('Optivie', 'orphane-a/optivie', 'https://preprod.optivie.orphane.fr', 'https://optivie.orphane.fr'),
  ('Demandez le programme', 'orphane-a/elections2027', 'https://preprod.demandez-le-programme.fr', 'https://demandez-le-programme.fr');
