-- Branche le projet Interface JDR (Auspex) sur son dépôt GitHub, créé sans dépôt à l'origine.
-- Sans dépôt, le lancement d'une étape échoue avec « le projet n'a pas de dépôt GitHub ».
UPDATE projets
SET depot = 'orphane-a/auspex',
    url_preprod = 'https://preprod.auspex.orphane.fr',
    url_prod = 'https://auspex.orphane.fr',
    branche_principale = 'main'
WHERE nom = 'Interface JDR';
