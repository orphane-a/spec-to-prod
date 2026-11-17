# 🚀 PRD Spec to prod : kanban de pilotage du backlog à la production

17 novembre 2026 · Statut : brouillon v1 📝

## 🎯 Résumé

Spec to prod est un kanban qui pilote chaque projet Claude depuis le backlog jusqu'à la mise en production. L'utilisatrice garde la main sur les décisions clés (lancer la conception, lancer le développement, lancer la prod) et l'IA prend en charge les étapes lourdes : rédaction de la spec, développement dans Claude Code, tests, déploiement. 🤖

## 🧩 Problème

Aujourd'hui, passer d'une idée à une version en production oblige à enchaîner à la main des outils séparés : rédaction de spec, Claude Code, GitHub, tests, déploiement. Il n'existe pas de vue d'ensemble de l'avancement ni de garde fous homogènes d'un projet à l'autre.

Conséquences si rien ne change : des idées qui stagnent dans le backlog, des tests oubliés ou incomplets, des mises en prod sans scénarios de validation clairs, et une perte de contexte entre chaque étape.

⚠️ Ce constat vient du besoin exprimé, pas encore de données mesurées. La première version doit permettre de mesurer le temps réel passé entre chaque étape.

## 🏁 Objectifs

- 👀 **Une vue unique** : voir en un coup d'œil l'étape de chaque ticket, du backlog à Done.
- 🖱️ **Peu d'actions manuelles** : trois décisions humaines par ticket (lancer la conception, lancer le dev, lancer la prod), plus la saisie du backlog et les tests humains.
- 🛡️ **Qualité garantie avant test humain** : aucun ticket n'arrive en colonne En test sans tests unitaires et de non régression au vert, test exploratoire passé et préprod déployée.
- 🧾 **Traçabilité** : chaque ticket conserve sa spec, sa branche, ses résultats de tests, ses scénarios et son historique de déploiement.
- 🔒 **Prod protégée** : aucun déploiement en production sans validation humaine explicite.

## 🚫 Non objectifs

- 👥 Pas de multi utilisateur ni de gestion de droits en v1, car l'usage est personnel et cela alourdirait l'architecture sans gain immédiat.
- 🔗 Pas de synchronisation avec Jira, Linear ou GitHub Issues, car le backlog est alimenté à la main par choix.
- ✨ Pas de création de tickets par l'IA, pour garder la maîtrise des priorités.
- 💻 Pas d'éditeur de code dans l'interface : le code vit dans Claude Code et GitHub.
- 🚦 Pas de stratégies de déploiement avancées (blue green, canary) : un déploiement simple suffit pour des projets de cette taille.

## 🗺️ Parcours d'un ticket

| Transition | Déclencheur | Ce qui se passe | Résultat attendu |
|---|---|---|---|
| 📥 Backlog → 🧠 En conception | Action utilisateur | Lancement de la feature write spec sur le ticket | PRD généré et rattaché au ticket |
| 🧠 En conception → 🛠️ En dev | Action utilisateur (validation de la spec) | Envoi à Claude Code, création d'une branche GitHub dédiée, développement, tests unitaires et de non régression, agent de test exploratoire, boucle jusqu'à obtenir un code propre, déploiement sur la préprod | Code propre, tests au vert, préprod déployée |
| 🛠️ En dev → 🧪 En test | Automatique | Passage dès que l'étape précédente est terminée et que tout est testé en préprod, puis écriture dans le ticket des scénarios de test à réaliser par l'humain | Scénarios de test présents dans le ticket |
| 🧪 En test → 🚀 Déploiement en prod | Action utilisateur | Envoi de la branche en prod et déploiement | Déploiement lancé |
| 🚀 Déploiement en prod → ✅ Done | Automatique | Passage dès que le déploiement est terminé | Déploiement confirmé, ticket clos |

### 🔐 Règles transverses

- Les trois passages manuels sont les seuls points de contrôle humain, avec les tests de la colonne En test.
- Un ticket ne saute jamais de colonne : chaque passage respecte le déclencheur du tableau.
- Une étape qui échoue ou qui boucle trop longtemps laisse le ticket dans sa colonne avec un badge Bloqué et la raison visible. Rien n'avance tout seul dans ce cas.
- La boucle de développement a un nombre maximum d'itérations. Au delà, le ticket passe en Bloqué et l'utilisatrice est prévenue.

## 👤 User stories

**Utilisatrice propriétaire du kanban**

- 📝 En tant qu'utilisatrice, je veux ajouter un ticket au backlog avec un titre et une description libre afin de capturer une idée sans friction.
- 🧠 En tant qu'utilisatrice, je veux lancer la rédaction de la spec depuis un ticket afin de transformer une idée vague en PRD exploitable.
- 👀 En tant qu'utilisatrice, je veux relire la spec avant de lancer le dev afin de ne pas faire coder quelque chose de mal cadré.
- 🛠️ En tant qu'utilisatrice, je veux lancer le développement en un clic afin de déléguer l'implémentation à Claude Code.
- 📡 En tant qu'utilisatrice, je veux suivre l'avancement du développement (branche, itérations, résultats de tests) afin de savoir où en est le ticket sans ouvrir plusieurs outils.
- 🧪 En tant qu'utilisatrice, je veux recevoir des scénarios de test clairs dans le ticket afin de valider rapidement en préprod.
- 🚀 En tant qu'utilisatrice, je veux déclencher la mise en prod après mes tests afin de garder la décision finale.
- ✅ En tant qu'utilisatrice, je veux que le ticket passe seul en Done à la fin du déploiement afin de ne pas faire de mise à jour manuelle.

**Cas limites**

- 🚨 En tant qu'utilisatrice, je veux être alertée quand une étape échoue ou boucle trop longtemps afin d'intervenir au bon moment.
- ↩️ En tant qu'utilisatrice, je veux renvoyer un ticket en dev quand mes tests humains échouent afin de relancer un cycle de correction sans repartir de zéro.
- 📭 En tant qu'utilisatrice, je veux un message clair quand une colonne est vide afin de savoir que ce n'est pas un bug.

## ✅ Exigences

### 🔴 P0 : indispensables

**P0.1 Tableau et backlog manuel** 📋

- [ ] Le tableau affiche six colonnes : Backlog, En conception, En dev, En test, Déploiement en prod, Done.
- [ ] Je peux créer, modifier et supprimer un ticket du backlog (titre, description, projet concerné).
- [ ] Seul le backlog accepte la création manuelle de tickets.
- [ ] Aucun ticket ne peut être déplacé par glisser déposer vers une colonne qui ne respecte pas le parcours.

**P0.2 Backlog vers En conception** 🧠

- [ ] Étant donné un ticket du backlog, quand je clique sur Lancer la conception, alors le ticket passe en En conception et la feature write spec démarre.
- [ ] La spec générée est rattachée au ticket et consultable depuis la carte.
- [ ] Si la génération échoue, le ticket reste en Backlog ou En conception avec une erreur visible, sans perte de la description d'origine.

**P0.3 En conception vers En dev** 🛠️

- [ ] Le bouton Lancer le dev n'est actif que si une spec est rattachée au ticket.
- [ ] Au clic, une branche GitHub dédiée au ticket est créée avec un nom prévisible (identifiant du ticket et titre court).
- [ ] Claude Code reçoit la spec et développe sur cette branche, jamais sur la branche principale.
- [ ] La boucle enchaîne : tests unitaires, tests de non régression, agent de test exploratoire, corrections, puis nouvelle passe.
- [ ] La boucle s'arrête quand tous les tests sont verts et que l'agent exploratoire ne remonte plus d'anomalie bloquante.
- [ ] Le code est alors déployé sur la préprod.
- [ ] Le nombre d'itérations est limité. Au delà, le ticket passe en Bloqué avec un résumé des échecs.

**P0.4 En dev vers En test** 🧪

- [ ] Le passage en En test est automatique, uniquement si la préprod est déployée et tous les tests sont au vert.
- [ ] Des scénarios de test humains sont écrits dans le ticket : objectif, étapes, résultat attendu, lien de la préprod.
- [ ] Les scénarios couvrent le cas nominal, au moins un cas d'erreur et les critères d'acceptation de la spec.
- [ ] Le ticket n'arrive jamais en En test sans scénarios.

**P0.5 En test vers Déploiement en prod** 🚀

- [ ] Le bouton Déployer en prod est présent uniquement en colonne En test et demande une confirmation explicite.
- [ ] Au clic, la branche est envoyée en prod et le déploiement démarre.
- [ ] Si le déploiement échoue, le ticket reste en Déploiement en prod avec le statut Bloqué et l'erreur affichée. Il ne passe jamais en Done.

**P0.6 Déploiement en prod vers Done** ✅

- [ ] Le ticket passe automatiquement en Done quand le déploiement est confirmé terminé.
- [ ] La date et la version déployée sont enregistrées dans le ticket.

**P0.7 Journal du ticket** 🧾

- [ ] Chaque transition, action utilisateur, itération de la boucle et résultat de test est horodaté dans l'historique du ticket.

**P0.8 Gestion du quota épuisé** ⏳

- [ ] Quand le quota Claude (fenêtre de 5 heures ou limite hebdomadaire) est atteint, le ticket concerné passe en statut Bloqué avec le motif « Quota Claude atteint » et l'heure de reprise estimée.
- [ ] Aucun achat de tokens API n'est déclenché : la clé ANTHROPIC_API_KEY n'est jamais définie dans l'environnement d'exécution.
- [ ] L'indicateur de quota de la semaine reste visible en haut du tableau.
- [ ] En v1, un ticket bloqué pour cause de quota reprend uniquement sur action de l'utilisatrice, une fois le quota rétabli. Il ne repart jamais tout seul.
- [ ] Les crédits d'usage payants restent désactivés par défaut : les activer est un choix de l'utilisatrice, fait hors de l'application.

### 🟠 P1 : souhaitables

- 🔔 Notifications (push ou email) quand un ticket est Bloqué, arrive en En test ou passe en Done.
- ↩️ Retour arrière : renvoyer un ticket de En test vers En dev avec le retour de mes tests humains.
- 🔗 Liens directs vers la pull request, les logs de tests et la préprod depuis la carte.
- ✏️ Édition de la spec après génération, avec historique des versions.
- 🗂️ Filtre par projet.
- ⏪ Procédure de rollback guidée en cas de souci après la prod.

### 🟡 P2 : à anticiper dans l'architecture

- 👥 Plusieurs utilisateurs et plusieurs espaces de travail.
- 📥 Import d'issues GitHub dans le backlog.
- 📈 Tableau de bord de métriques (temps par colonne, taux de blocage).
- 🤝 Saisie des résultats des tests humains directement dans l'interface (réussi, échoué, commentaire).
- 🌍 Plus de deux environnements (par exemple recette client).

## 📊 Métriques de succès

**Indicateurs avancés** (premières semaines) ⚡

| Indicateur | Cible de succès | Cible ambitieuse |
|---|---|---|
| Tickets menés de En conception à En test sans intervention technique manuelle | 70 % | 90 % |
| Itérations moyennes de la boucle de dev | 5 ou moins | 3 ou moins |
| Tickets Bloqués par étape | moins de 20 % | moins de 10 % |
| Scénarios de test écrits pour les tickets arrivés en En test | 100 % | 100 % |

**Indicateurs retardés** (1 à 3 mois) 🐢

| Indicateur | Cible de succès | Cible ambitieuse |
|---|---|---|
| Délai entre le lancement de la conception et la mise en prod | 50 % plus court que le processus manuel actuel (référence à mesurer) | 70 % plus court |
| Régressions détectées en prod après déploiement | 1 par mois maximum | 0 |
| Tickets passés en Done par mois | à définir après le premier mois de mesure | à définir |

Mesure : horodatages du journal de chaque ticket. Évaluation à 1 mois, puis à 3 mois après la mise en service.

## 🔌 Faisabilité technique avec l'abonnement Claude

Le projet est faisable sans aucun achat de tokens API : le pilotage de Claude Code passe par l'abonnement, grâce aux tâches planifiées cloud avec déclencheur API. Informations vérifiées le 17 novembre 2026.

**Principe** 🧭

- Chaque colonne lancée par l'utilisatrice appelle une tâche cloud : un appel HTTP avec un jeton propre à la tâche démarre une session Claude Code et renvoie l'URL de cette session.
- La session clone le dépôt, travaille sur une branche, lance les tests et l'agent exploratoire, puis signale sa fin.
- Les sessions consomment le quota d'abonnement, partagé avec les conversations Claude.
- La fonction est en préversion : son format peut changer.

**Architecture recommandée** 🏗️

| Étape | Mécanisme | Consomme du quota Claude |
|---|---|---|
| Backlog vers En conception | Write spec, en session ou en tâche déclenchée | Oui |
| En conception vers En dev | Tâche cloud déclenchée avec l'identifiant du ticket | Oui |
| En dev vers En test | La session écrit les scénarios dans le ticket et signale sa fin | Oui, dans le même run |
| En test vers Déploiement en prod | Pipeline GitHub Actions classique avec SSH | Non |
| Déploiement en prod vers Done | Le pipeline notifie le tableau | Non |

**Contraintes à traiter** ⚠️

- Il n'existe pas de retour d'état documenté : la session doit signaler sa fin elle même (webhook vers un petit relais sur le serveur, ou fichier de statut commité).
- Le jeton de déclenchement ne doit pas se trouver dans la page du tableau. Un relais sur le serveur le garde au secret.
- L'environnement cloud limite le réseau par défaut : il faut autoriser les domaines utiles à la préprod et stocker les secrets comme secrets réseau.
- Le texte transmis au déclenchement est traité comme une donnée non fiable : le prompt enregistré doit demander explicitement de le lire.
- Plafonds de déclenchement : 30 par heure et par tâche, 100 par heure sur le compte.
- Ne jamais définir ANTHROPIC_API_KEY dans l'environnement, sinon Claude Code facture l'API au lieu de l'abonnement.

**Coût : pas d'achat de tokens API, mais un quota à gérer** 💶

Un coût supplémentaire n'apparaît que si l'utilisatrice active elle même les crédits d'usage. Sinon, quand le quota est épuisé, les runs suivants sont rejetés jusqu'à la réinitialisation. L'application doit donc afficher le quota, bloquer proprement les tickets concernés (voir P0.8) et ne jamais contourner la limite. Les crédits API mensuels inclus avec Max ne servent pas à Claude Code.

Sources : [Trigger a routine through the API](https://platform.claude.com/docs/en/api/claude-code/routines-fire), [Scheduled tasks](https://code.claude.com/docs/en/routines), [Agent SDK avec votre forfait Claude](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan), [Claude Code avec Pro ou Max](https://support.claude.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan).

## ❓ Questions ouvertes

Chaque question porte un choix par défaut, retenu pour avancer tant que la réponse n'est pas tranchée. 17 novembre 2026.

**Bloquantes** 🛑

- 🏗️ **Technique** : où sont stockés les tickets et sous quelle forme est l'interface (page publiée avec base de données intégrée, application hébergée) ?
  Par défaut : application hébergée sur le VPS OVH, base SQLite dans un seul fichier, facile à sauvegarder pour une seule utilisatrice.
- 🔌 **Technique** : comment l'interface déclenche Claude Code et GitHub (piste retenue : tâche cloud à déclencheur API, voir la section Faisabilité) et avec quels droits ?
  Par défaut : une tâche cloud par étape (spec, dev), chacune avec son jeton /fire gardé côté serveur, et un jeton GitHub à droits fins limité aux dépôts concernés.
- 🌐 **Technique** : quelles sont les cibles de préprod et de prod pour chaque projet, et comment se fait le déploiement (par exemple SSH sur un serveur) ?
  Par défaut : chaque projet porte son dépôt, son URL de préprod et son URL de prod ; préprod sur un sous domaine preprod. du même VPS ; déploiement par GitHub Actions et SSH.
- 🧹 **Produit et technique** : que veut dire « code propre » concrètement (linter sans erreur, couverture minimale, revue par un agent) ?
  Par défaut : linter et typage sans erreur, tests unitaires et de non régression verts, couverture d'au moins 70 % des lignes, agent exploratoire sans anomalie bloquante.

**Non bloquantes** 🟢

- 🔁 Quel nombre maximum d'itérations avant de passer en Bloqué ? Par défaut : 5, réglable par la variable ITERATIONS_MAX.
- 🌿 La branche est elle fusionnée avant ou après le déploiement en prod ? Par défaut : avant, c'est la première étape du déploiement.
- 📦 Un ticket correspond il toujours à un seul dépôt GitHub ? Par défaut : oui, le dépôt est porté par le projet du ticket.
- 🗄️ Comment gérer les migrations de données lors du passage en prod ? Par défaut : le pipeline sauvegarde la base puis joue les migrations avant le redémarrage.
- 🔑 Où sont stockés les secrets nécessaires au déploiement ? Par défaut : secrets GitHub Actions pour SSH, fichier .env sur le VPS pour le reste, jamais dans le dépôt.

**Décisions prises pendant la phase 1** 🧭

- 📊 Source de la jauge de quota : aucune API ne donne le quota de l'abonnement. Par défaut : valeur transmise par les webhooks des sessions (fictive en mode simulé), et passage en épuisé dès qu'un lancement est refusé pour quota.
- 🔐 Accès au tableau sur internet : un mot de passe unique (MOT_DE_PASSE), un cookie de session signé valable 30 jours, blocage de 15 minutes après 5 essais ratés. Spec to prod ne sert qu'à son utilisatrice et à ses projets branchés sur son compte Claude.
- 🧠 Échec de rédaction de la spec : le ticket reste en En conception avec le badge Bloqué, sa description intacte.
- 🌿 Nom de branche : claude/identifiant-titre-court, par exemple claude/12-fiche-personnage.
- 🖱️ Glisser déposer : absent en v1. Seuls les boutons font avancer un ticket, ce qui rend tout saut de colonne impossible.
- 🔄 Relance d'un ticket bloqué : un bouton Relancer, toujours manuel ; en dev, la boucle repart avec un compteur d'itérations remis à zéro.
- 🧪 Scénarios de test : au moins deux (cas nominal et cas d'erreur) pour passer en En test ; ils se cochent seulement pendant la phase de test.
- ↩️ Retour de En test vers En dev : reporté, il fait partie des exigences P1.
- 💾 SQLite passe par le module node:sqlite intégré à Node, car la politique de sécurité Windows bloque les modules natifs comme better-sqlite3.
- 📥 Reprise des anciens kanbans en artefact (Optivie, Elections 2027 devenu Demandez le programme) : les colonnes En test IA et En test Anne vont toutes deux dans En test, les cartes supprimées ne sont pas reprises, l'historique de chaque carte devient son journal. Le projet AMLF est retiré.

**Décisions prises pour la connexion à Claude** 🔌

- 🎨 Étape design : elle fait partie de En conception. La spec prête lance seule le design, et Lancer le dev exige la spec et le design. Un ticket repris avec une spec mais sans design propose Lancer le design.
- 🖼️ Livrable du design : une maquette HTML autonome commitée sur la branche du ticket (maquettes/ticket-identifiant.html), plus un résumé markdown dans le ticket.
- 🌿 La branche est donc fixée dès Lancer la conception, et non plus au lancement du dev.
- 🧩 Une tâche cloud par étape (spec, design, dev), chacune avec son URL /fire et son jeton dans le fichier .env du serveur. Les prompts sont versionnés dans taches-cloud.
- ⏳ Réponse 429 de /fire : le ticket passe en Bloqué avec « Quota Claude atteint » et l'heure de reprise tirée de Retry-After. L'endpoint ne distingue pas la limite de lancements du quota d'abonnement.
- 🔁 Aucune relance automatique d'un appel /fire : l'endpoint n'est pas idempotent, un nouvel essai lancerait une deuxième session.
- 🔕 Session silencieuse : sans signalement depuis 60 minutes (RUN_SILENCE_MAX_MIN), le ticket passe en Bloqué avec le lien de la session. Cela couvre un quota épuisé en cours de run, que rien d'autre ne signale.
- 🔐 Les sessions cloud signent leurs webhooks avec le secret partagé, stocké comme variable de l'environnement cloud (SPEC_TO_PROD_SECRET), via le script taches-cloud/signaler.mjs.

**Décisions prises pour la préprod et la prod** 🚀

- 🧪 Fin du dev : le ticket reste En dev et la préprod est déployée seule. Il passe En test seulement quand le pipeline confirme que la préprod affiche la bonne version, comme l'exige P0.4.
- 🔒 Une seule préprod par projet : un deuxième ticket du même projet est bloqué avec « Préprod occupée par le ticket X » tant que le premier est en test. La relance, manuelle, ne refait que la préprod.
- ⚙️ Pipeline : chaque projet porte .github/workflows/spec-to-prod.yml, lancé par le kanban (workflow_dispatch) avec un jeton GitHub à droits fins limité au droit Actions. Le pipeline déploie avec ses propres secrets et prévient le kanban avec taches-cloud/pipeline.mjs.
- 🌿 Fusion avant la mise en prod : le pipeline fusionne la branche du ticket dans la branche principale, puis déploie et vérifie la version.
- 🟢 Optivie : la branche preprod devient une copie de la branche du ticket, Coolify déploie, /api/sante doit afficher le commit. Il faut activer SOURCE_COMMIT dans Coolify.
- 🗳️ Demandez le programme : deployer.sh publie et écrit public/version.txt, que le pipeline vérifie.
- 🏠 Hébergement de Spec to prod : application Coolify sur le VPS, sous domaine kanban.orphane.fr par défaut, base SQLite sur un volume.

## 🗓️ Planning et phasage

Aucune date butoir n'a été fournie. Je propose trois phases pour apprendre vite. 🧭

- 🥇 **Phase 1, MVP** : tableau, backlog manuel, write spec, lancement du dev sur un seul projet pilote avec déploiement en préprod.
- 🥈 **Phase 2, automatisation complète** : boucle de tests avec agent exploratoire, scénarios de test humains, déploiement en prod, passages automatiques vers En test et Done.
- 🥉 **Phase 3, confort** : notifications, retour arrière, métriques, plusieurs projets.

Dépendances : accès à GitHub, définition des environnements de préprod et de prod, réponse aux questions bloquantes ci dessus avant le début de la phase 1.
