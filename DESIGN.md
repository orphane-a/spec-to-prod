# Spec to prod : direction visuelle

La maquette du tableau est dans maquette/Main.dc.html. C'est un fichier du canevas de design : il sert de référence visuelle (structure, styles, textes, états), il ne s'ouvre pas tout seul dans un navigateur. Reproduis le rendu en React, ne copie pas le fichier tel quel.

## Idée centrale : la voie
Une ligne horizontale relie les six colonnes, comme une voie ferrée.
1. Une station (rond encre) au dessus de chaque colonne.
2. Entre deux stations, un marqueur dit qui décide : un carré ambre avec une silhouette quand c'est moi, un rond vert d'eau avec une flèche circulaire quand le passage est automatique.
3. La dernière station (Done) est verte.
Sous le nom de chaque colonne, une ligne dit ce qui se passe ensuite : « Vous lancez la conception », « Vous lancez le développement », « Passe seul en test », « Vous lancez la mise en prod », « Passe seul en Done ».

## Couleurs
1. Brume, fond de page : #E8EDEF
2. Papier, fond des colonnes : #F4F7F8
3. Encre, texte et boutons sombres : #14233A
4. Texte secondaire : #4A5A6E
5. Ambre signal, action qui attend ma décision : #F2AE1B (texte dessus en encre)
6. Vert d'eau, automatique ou en cours : #2B6B6E
7. Vert validé : #26663F
8. Rouge bloqué : texte #8A1F1A sur fond #FBE6E3, bordure rgba(176,42,36,0.45)
9. Rails de progression vides : #C3CFD5

Règle : un bouton plein ambre signifie qu'une action attend ma décision maintenant. Les autres boutons sont contourés en encre.

## Typographie
Bricolage Grotesque (Google Fonts), poids 400 à 700, une seule famille. Titre de page 28 px gras, noms de colonnes 19 px, titres de cartes 15 px, texte courant 13 px, minimum 12 px.

## Cartes
Rayon 10 px, bordure fine, pas d'ombre. Chaque état a son anatomie :
1. Backlog : titre, projet, une phrase, bouton contouré « Lancer la conception ».
2. En conception : « Spec prête » avec bouton ambre « Lancer le dev », ou « Claude rédige la spec » avec bouton grisé en pointillés et une phrase d'explication.
3. En dev : branche, « Itération 3 sur 5 » avec cinq segments, trois contrôles (tests unitaires, non régression, test exploratoire).
4. Bloqué : fond rouge clair, icône d'alerte, motif en une phrase, bouton « Ouvrir le journal ».
5. En test : « Préprod à jour », progression des scénarios, boutons « Ouvrir les scénarios » et ambre « Déployer en prod ».
6. Déploiement en prod : trois étapes (fusion, envoi sur le serveur, vérification).
7. Done : carte compacte avec la date de mise en ligne.

## En haut de page
Logo en trois points (encre, ambre, vert d'eau), titre Spec to prod, filtres par projet, jauge « Quota Claude de la semaine », bouton « Ajouter un ticket ».

## Qualité minimale
Boutons réels, cibles de 44 px, focus clavier visible, contrastes de 4,5 pour 1, lisible jusqu'à la largeur d'un téléphone (le tableau défile horizontalement dans sa boîte). Les icônes sont des SVG au trait, jamais des emojis.

## À prévoir ensuite
Fiche d'un ticket (spec, scénarios de test, journal) et bandeau « Quota épuisé » avec l'heure de reprise estimée.
