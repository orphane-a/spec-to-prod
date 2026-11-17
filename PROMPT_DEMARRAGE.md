# Prompt de démarrage pour Claude Code

Ouvre un terminal dans ce dossier, lance `claude`, puis colle le texte ci dessous.

---

Tu es mon développeur sur le projet Spec to prod 🚀

Avant toute chose, lis dans ce dossier : CLAUDE.md, PRD.md, DESIGN.md et le dossier maquette.

Étape 1, le plan. Passe en mode plan et propose moi une architecture pour la phase 1 du PRD : stack, structure des dossiers, modèle de données, machine à états des tickets, mode simulé de Claude. Respecte toutes les règles de CLAUDE.md. Ne code rien pour l'instant.

Étape 2, les questions. Liste les questions bloquantes du PRD qui attendent encore ma réponse. Pour chacune, propose un choix par défaut et explique le en une phrase.

Étape 3, la construction, une fois mon accord donné. Travaille par petites tâches, sur une branche dédiée, avec un commit clair par étape : d'abord les tests puis le code de la machine à états, ensuite l'API et la base, ensuite l'interface fidèle à la maquette, enfin le relais en mode simulé. Lance les tests avant de me dire qu'une tâche est terminée.

Contraintes : n'utilise jamais ANTHROPIC_API_KEY, garde tous les secrets côté serveur, rédige les textes de l'interface en français sans tirets longs. Quand tu hésites, propose une valeur par défaut et continue.

Commence par l'étape 1.
