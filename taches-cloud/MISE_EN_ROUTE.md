# Passer Spec to prod en mode réel

Ce guide met Spec to prod en ligne sur le VPS et le branche sur les vrais Claude (spec, design, dev) et sur les pipelines de tes projets (préprod, prod).

Il fonctionne ainsi :
- Chaque étape Claude est une tâche cloud Claude Code déclenchée par API. Elle consomme le quota de ton abonnement, jamais l'API payante.
- La préprod et la prod passent par le pipeline GitHub Actions de chaque projet (`.github/workflows/spec-to-prod.yml`).
- Le serveur garde les jetons, la page du tableau ne les voit jamais.

Spec to prod sert une seule personne : toi. Le tableau est protégé par un mot de passe unique.

## 1. Préparer les secrets

Sur ton poste, génère deux valeurs et garde les le temps de la mise en route :

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

- `WEBHOOK_SECRET` : le secret partagé avec les sessions Claude et les pipelines.
- `MOT_DE_PASSE` : ton mot de passe du tableau, d'au moins 12 caractères.

## 2. Mettre Spec to prod en ligne

1. Chez ton fournisseur de domaine, ajoute un enregistrement A `kanban.orphane.fr` vers `148.113.144.242`.
2. Dans Coolify, crée une application depuis le dépôt `orphane-a/spec-to-prod`, branche `main`, en mode Docker Compose (`docker-compose.yml`). Règle le domaine `https://kanban.orphane.fr` sur le service « kanban ».
3. Active l'option qui fournit `SOURCE_COMMIT` au build : `/api/sante` affichera la version déployée.
4. Saisis les variables d'environnement dans Coolify, jamais dans le dépôt :

| Variable | Valeur |
|---|---|
| `CLAUDE_MODE` | `reel` |
| `MOT_DE_PASSE` | ton mot de passe |
| `WEBHOOK_SECRET` | le secret partagé |
| `RELAIS_URL_PUBLIQUE` | `https://kanban.orphane.fr` |
| `GITHUB_JETON` | voir l'étape 4 |
| `ROUTINE_SPEC_URL`, `ROUTINE_SPEC_JETON` | voir l'étape 3 |
| `ROUTINE_DESIGN_URL`, `ROUTINE_DESIGN_JETON` | voir l'étape 3 |
| `ROUTINE_DEV_URL`, `ROUTINE_DEV_JETON` | voir l'étape 3 |

Au démarrage, le serveur refuse de partir s'il manque une valeur et nomme celle qui manque. La base vit sur un volume Docker : elle survit aux mises à jour.

**Reprendre tes tickets actuels.** Arrête ton serveur local, puis exporte la base :

```bash
node -e "new (require('node:sqlite').DatabaseSync)('donnees/spec-to-prod.db').exec(\"VACUUM INTO 'donnees/export.db'\")"
```

Envoie `donnees/export.db` sur le serveur, arrête l'application dans Coolify, copie le fichier dans le volume sous le nom `spec-to-prod.db`, puis redémarre. Claude peut t'aider pour cette copie.

## 3. Créer l'environnement et les tâches Claude

Sur claude.ai/code, crée un environnement nommé « spec-to-prod » :

- Réseau : « Limited », avec « Allow package managers » coché, et ajoute `kanban.orphane.fr` aux domaines autorisés.
- Variable d'environnement : `SPEC_TO_PROD_SECRET` égale à `WEBHOOK_SECRET`.
- Ne définis jamais `ANTHROPIC_API_KEY` ni `ANTHROPIC_AUTH_TOKEN`.

Sur claude.ai/code/routines, crée trois tâches :

| Tâche | Prompt à coller |
|---|---|
| Spec to prod : spec | `taches-cloud/spec.md`, à partir de la ligne « Tu rédiges » |
| Spec to prod : design | `taches-cloud/design.md`, à partir de la ligne « Tu conçois » |
| Spec to prod : dev | `taches-cloud/dev.md`, à partir de la ligne « Tu développes » |

Pour chacune :
- Dépôts : `orphane-a/spec-to-prod`, `orphane-a/optivie` et `orphane-a/elections2027`.
- Environnement : « spec-to-prod ».
- Connecteurs : retire tous ceux dont la tâche n'a pas besoin. Ne mets aucune planification horaire.
- Déclencheur : ajoute un déclencheur API, copie l'URL `https://api.anthropic.com/v1/claude_code/routines/trig_.../fire`, puis génère le jeton. Il ne s'affiche qu'une fois : colle le directement dans Coolify.

## 4. Brancher GitHub

**Le jeton du kanban.** Sur GitHub, dans Settings, Developer settings, Fine-grained tokens, crée un jeton :
- Dépôts : seulement `orphane-a/optivie` et `orphane-a/elections2027`.
- Droits : Actions en lecture et écriture, Contents en lecture seule, rien d'autre.

Colle le dans Coolify sous `GITHUB_JETON`. Il sert à lancer les pipelines et à lire les maquettes pour les afficher dans la fiche du ticket.

**Dans chaque dépôt de projet**, dans Settings, Secrets and variables, Actions :
- Secret `SPEC_TO_PROD_SECRET` : la valeur de `WEBHOOK_SECRET`.
- Variable `SPEC_TO_PROD_URL` : `https://kanban.orphane.fr`.
- La branche principale doit accepter le push du pipeline : aucune protection ne doit l'interdire à GitHub Actions.

**Optivie** ([orphane-a/optivie#21](https://github.com/orphane-a/optivie/pull/21)) :
- Dans Coolify, pour la préprod et la prod d'Optivie, active l'option qui fournit `SOURCE_COMMIT`. Aujourd'hui `/api/sante` répond `"commit":"local"`, et le pipeline attendrait en vain.
- La branche `preprod` est écrasée à chaque passage en préprod : elle ne doit servir qu'à ça.
- Fusionne la pull request.

**Demandez le programme** ([orphane-a/elections2027#1](https://github.com/orphane-a/elections2027/pull/1)) :
- Crée une clé SSH dédiée au déploiement :

  ```bash
  ssh-keygen -t ed25519 -f spec-to-prod-deploiement -N "" -C spec-to-prod
  ```

- Ajoute `spec-to-prod-deploiement.pub` à `~/.ssh/authorized_keys` du compte `ubuntu` sur le serveur.
- Secret `SSH_CLE_PRIVEE` : le contenu de `spec-to-prod-deploiement`.
- Secret `SSH_HOTE_CONNU` : la sortie de `ssh-keyscan -t ed25519 148.113.144.242`.
- Supprime ensuite les deux fichiers de clé de ton poste, puis fusionne la pull request.

## 5. Premier essai

1. Ouvre `https://kanban.orphane.fr` et connecte toi.
2. Crée un petit ticket pour Demandez le programme, puis clique sur Lancer la conception. Le journal du ticket affiche le lien de la session Claude.
3. Quand Claude a fini le dev, la carte affiche « Déploiement en préprod ». Le journal donne le lien du pipeline GitHub.
4. Le ticket passe en test quand la préprod affiche la bonne version. Fais tes tests, puis clique sur Déployer en prod et confirme.
5. Le ticket passe en Done quand la prod affiche la nouvelle version.

## Ce qui peut bloquer un ticket

| Motif affiché | Cause | Que faire |
|---|---|---|
| Quota Claude atteint | La tâche cloud a répondu 429 : limite de lancements (30 par heure par tâche, 100 par heure sur le compte) ou quota de l'abonnement | Attendre l'heure de reprise, puis cliquer sur Relancer |
| La session ne donne plus de nouvelles | Aucun signalement depuis `RUN_SILENCE_MAX_MIN` minutes : quota épuisé en cours de route, session ou pipeline arrêté | Ouvrir le lien du journal, puis Relancer |
| Préprod occupée par le ticket X | Un autre ticket du même projet est en test sur la préprod | Mettre l'autre ticket en prod, puis Relancer |
| Le pipeline preprod (ou prod) a échoué | Erreur dans GitHub Actions : SSH, build, ou version jamais apparue | Ouvrir le lien du run GitHub, corriger, puis Relancer |
| Pipeline introuvable | `spec-to-prod.yml` absent de la branche principale du projet | Fusionner la pull request du pipeline |
| Le jeton GitHub (ou de la tâche cloud) est refusé | Jeton expiré ou mal copié | En générer un nouveau et le mettre à jour dans Coolify |

Rien ne repart tout seul : chaque relance est un clic de ta part.
