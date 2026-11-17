# Brancher les vrais Claude

Ce guide passe Spec to prod du mode simulé au mode réel, pour les étapes spec, design et dev. Le déploiement en prod reste à brancher.

Chaque étape est une tâche cloud Claude Code déclenchée par API. Elle consomme le quota de ton abonnement, jamais l'API payante. Le serveur garde les jetons, la page du tableau ne les voit jamais.

## Avant de commencer

- Le relais doit être en ligne en https, par exemple `https://kanban.orphane.fr`. Les sessions cloud l'appellent pour signaler leur avancement : un serveur qui tourne sur ton poste ne les recevra pas.
- Le dépôt `orphane-a/spec-to-prod` doit être poussé sur GitHub : les sessions y prennent le script `taches-cloud/signaler.mjs`.
- La fonction est en préversion chez Anthropic : son format peut changer.

## 1. Créer le secret partagé

Sur le serveur, génère un secret d'au moins 32 caractères :

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Garde le pour les étapes 2 et 4.

## 2. Créer l'environnement cloud

Sur claude.ai/code, crée un environnement nommé « spec-to-prod » :

- Réseau : « Limited », avec « Allow package managers » coché, et ajoute le domaine du relais (par exemple `kanban.orphane.fr`) à la liste des domaines autorisés.
- Variable d'environnement : `SPEC_TO_PROD_SECRET` égale au secret de l'étape 1.
- Ne définis jamais `ANTHROPIC_API_KEY` ni `ANTHROPIC_AUTH_TOKEN`.

## 3. Créer les trois tâches

Sur claude.ai/code/routines, crée trois tâches. Pour chacune :

| Tâche | Prompt à coller |
|---|---|
| Spec to prod : spec | contenu de `taches-cloud/spec.md`, à partir de la ligne « Tu rédiges » |
| Spec to prod : design | contenu de `taches-cloud/design.md`, à partir de la ligne « Tu conçois » |
| Spec to prod : dev | contenu de `taches-cloud/dev.md`, à partir de la ligne « Tu développes » |

- Dépôts : `orphane-a/spec-to-prod` et les dépôts des projets pilotés (`orphane-a/optivie`, `orphane-a/elections2027`).
- Environnement : « spec-to-prod ».
- Connecteurs : retire tous ceux dont la tâche n'a pas besoin.
- Aucune planification horaire.
- Déclencheur : ajoute un déclencheur API, copie l'URL `https://api.anthropic.com/v1/claude_code/routines/trig_.../fire`, puis génère le jeton. Il ne s'affiche qu'une fois : colle le directement dans le fichier `.env` du serveur.

## 4. Configurer le serveur

Dans le fichier `.env` du serveur, jamais dans le dépôt :

```
CLAUDE_MODE=reel
WEBHOOK_SECRET=<secret de l'étape 1>
RELAIS_URL_PUBLIQUE=https://kanban.orphane.fr
ROUTINE_SPEC_URL=https://api.anthropic.com/v1/claude_code/routines/trig_.../fire
ROUTINE_SPEC_JETON=sk-ant-oat01-...
ROUTINE_DESIGN_URL=...
ROUTINE_DESIGN_JETON=...
ROUTINE_DEV_URL=...
ROUTINE_DEV_JETON=...
RUN_SILENCE_MAX_MIN=60
```

Au démarrage, le serveur refuse de partir s'il manque une valeur, et nomme celle qui manque.

## 5. Premier essai

1. Crée un petit ticket dans le backlog, rattaché à un projet qui a un dépôt.
2. Clique sur Lancer la conception. Le journal du ticket affiche le lien de la session : ouvre le pour suivre Claude.
3. À la fin de la spec, le design démarre seul. Quand la maquette est prête, la carte affiche Voir le design et Lancer le dev.

## Ce qui peut bloquer un ticket

| Motif affiché | Cause | Que faire |
|---|---|---|
| Quota Claude atteint | La tâche a répondu 429 : limite de lancements (30 par heure par tâche, 100 par heure sur le compte) ou quota de l'abonnement | Attendre l'heure de reprise, puis cliquer sur Relancer |
| La session ne donne plus de nouvelles | Aucun signalement depuis `RUN_SILENCE_MAX_MIN` minutes (quota épuisé en cours de route, session arrêtée) | Ouvrir le lien de la session, puis Relancer |
| Le jeton de la tâche cloud est refusé | Jeton expiré ou mal copié | Générer un nouveau jeton et mettre à jour `.env` |
| La tâche cloud ne répond pas | Délai dépassé à l'appel | Vérifier sur claude.ai qu'aucune session n'a démarré avant de relancer, pour éviter un doublon |

Rien ne repart tout seul : chaque relance est un clic de ta part.
