# Spec to prod

Kanban personnel qui pilote les projets Claude du backlog à la mise en production. Le besoin est dans [PRD.md](PRD.md), la direction visuelle dans [DESIGN.md](DESIGN.md).

## Démarrer

Node.js 22 ou plus.

```bash
npm install
npm run dev
```

Le tableau s'ouvre sur http://localhost:5173 et l'API écoute sur le port 3000. Par défaut, Claude est simulé : un faux Claude répond après quelques secondes, sans consommer de quota.

Pour servir l'interface compilée par le serveur, comme en prod : `npm run build` puis `npm start`, et ouvrir http://localhost:3000.

La configuration se fait dans un fichier `.env` (voir [.env.example](.env.example)). Ne définissez jamais `ANTHROPIC_API_KEY` : le serveur refuse de démarrer si elle existe.

## Tester le mode simulé

Un mot clé dans la description d'un ticket provoque un incident, une seule fois, pour vérifier le bouton Relancer :

| Mot clé | Effet |
|---|---|
| `#simu:echec-spec` | la rédaction de la spec échoue |
| `#simu:iterations` | la boucle de dev atteint le maximum d'itérations |
| `#simu:quota` | le lancement est refusé, quota Claude atteint |
| `#simu:echec-deploiement` | le déploiement échoue à l'envoi sur le serveur |

## Vérifier

```bash
npm test
```

```bash
npm run e2e
```

```bash
npm run lint
```

```bash
npm run typecheck
```

`npm test` couvre la machine à états (matrice complète des transitions), l'API, les webhooks signés et le mode simulé. `npm run e2e` lance Playwright sur Edge.

## Organisation

- `src/domaine` : machine à états et types, sans dépendance au serveur ni au navigateur.
- `src/serveur` : Fastify, base SQLite (`node:sqlite`), service des tickets, relais et webhooks.
- `src/web` : interface React.
- `taches-cloud` : prompts des tâches cloud Claude (spec, design, dev), scripts de signalement des sessions et des pipelines, et guide `MISE_EN_ROUTE.md` pour passer en mode réel et mettre le tableau en ligne.
- `Dockerfile` et `docker-compose.yml` : mise en ligne par Coolify sur le VPS.
- `tests` : tests unitaires, API, relais et bout en bout.
