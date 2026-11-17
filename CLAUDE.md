# Spec to prod : consignes pour Claude Code

## Le projet
Spec to prod est un kanban personnel qui pilote mes projets Claude du backlog à la mise en production. Lis PRD.md pour le besoin complet, DESIGN.md et le dossier maquette pour l'interface.

Six colonnes : Backlog, En conception, En dev, En test, Déploiement en prod, Done.
Trois passages sont déclenchés par moi (Backlog vers En conception, En conception vers En dev, En test vers Déploiement en prod). Deux passages sont automatiques (En dev vers En test, Déploiement en prod vers Done). Un ticket peut en plus être Bloqué dans sa colonne, avec un motif visible.

## Règles à ne jamais enfreindre
1. Aucun appel à l'API Claude payante. Ne définis jamais ANTHROPIC_API_KEY, ne l'utilise jamais, ne la demande jamais. Claude Code est piloté par mon abonnement, via des tâches planifiées cloud à déclencheur API (endpoint /fire avec un jeton par tâche).
2. Les jetons et secrets restent côté serveur, dans des variables d'environnement. Jamais dans le code du navigateur, jamais dans le dépôt.
3. Un ticket ne saute jamais de colonne. La machine à états est la seule source de vérité des transitions, avec des tests qui couvrent chaque transition autorisée et chaque transition refusée.
4. Aucun déploiement en prod sans clic de confirmation de ma part.
5. Si le quota Claude est atteint, le ticket passe en Bloqué avec le motif « Quota Claude atteint ». Il ne repart jamais tout seul en v1.
6. Tous les textes de l'interface sont en français, sans tirets longs, sans majuscules d'étiquettes, en phrase simple.

## Stack proposée (à confirmer dans ton plan)
Node.js 22 et TypeScript partout, Fastify pour l'API et le relais, SQLite pour les données, React et Vite pour l'interface, Vitest pour les tests unitaires, Playwright pour les tests de bout en bout. Hébergement sur mon VPS OVH, derrière un sous domaine. Déploiement par GitHub Actions et SSH.
Si tu proposes mieux, justifie en trois lignes.

## Architecture visée
1. Interface : tableau kanban, fiche d'un ticket (spec, scénarios de test, journal), jauge de quota.
2. API : tickets, transitions, journal. Elle applique la machine à états.
3. Relais : appelle l'endpoint /fire de la bonne tâche cloud avec l'identifiant du ticket, et reçoit les webhooks de fin de run (session Claude Code et pipeline GitHub Actions) protégés par un secret partagé.
4. Mode simulé : un faux Claude qui répond après quelques secondes, pour développer et tester sans consommer de quota. Il est activé par une variable d'environnement et utilisé par défaut en tests.

## Modèle de données minimal
Ticket : identifiant, titre, description, projet, dépôt, colonne, bloqué (motif et date), spec en markdown, branche, itération courante et maximum, scénarios de test (objectif, étapes, résultat attendu, fait ou non), URL de préprod, version déployée, dates.
Événement de journal : ticket, date, type, détail.

## Façon de travailler
1. Commence toujours par un plan, que je valide, avant d'écrire du code.
2. Travaille par petites tâches, tests d'abord pour la machine à états et l'API.
3. Une branche dédiée par tâche, un commit clair par étape, jamais de commit direct sur la branche principale.
4. Lance les tests avant de dire qu'une tâche est terminée.
5. Quand une décision n'est pas dans le PRD, propose une valeur par défaut et note la dans PRD.md, section Questions ouvertes.

## Périmètre de la phase 1
Tableau, backlog manuel, création et lecture des tickets, machine à états complète avec tests, fiche ticket, journal, jauge de quota, relais avec mode simulé. Le branchement réel sur les tâches cloud et le déploiement en prod viennent en phase 2.
