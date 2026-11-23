import { expect, test, type Page } from '@playwright/test';

export const MOT_DE_PASSE = 'mot-de-passe-des-tests-e2e';

// Chaque parcours commence connecté : le cookie de session est partagé avec la page.
test.beforeEach(async ({ page }, info) => {
  if (info.title.startsWith('connexion')) return;
  const r = await page.request.post('/api/connexion', { data: { motDePasse: MOT_DE_PASSE } });
  expect(r.status()).toBe(204);
});

test('connexion : le tableau demande le mot de passe et refuse un mauvais', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Ajouter un ticket' })).toHaveCount(0);
  await page.getByLabel('Mot de passe').fill('mauvais mot de passe');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByText('Mot de passe incorrect.')).toBeVisible();
  await page.getByLabel('Mot de passe').fill(MOT_DE_PASSE);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('button', { name: 'Ajouter un ticket' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Ajouter un ticket' })).toBeVisible();
});

const colonne = (page: Page, nom: string) => page.getByRole('region', { name: nom, exact: true });

async function ajouterTicket(page: Page, titre: string, description: string) {
  await page.getByRole('button', { name: 'Ajouter un ticket' }).click();
  const fenetre = page.getByRole('dialog', { name: 'Ajouter un ticket au backlog' });
  await fenetre.getByLabel('Titre').fill(titre);
  await fenetre.getByLabel('Description').fill(description);
  await fenetre.getByLabel('Projet').selectOption({ label: 'Optivie' });
  await fenetre.getByRole('button', { name: 'Ajouter au backlog' }).click();
  await expect(fenetre).toBeHidden();
  return colonne(page, 'Backlog').getByRole('article', { name: titre });
}

test('un ticket va du backlog à Done avec trois décisions et une confirmation', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Spec to prod', level: 1 })).toBeVisible();
  await expect(colonne(page, 'En test').getByText('Aucun ticket à tester pour l’instant.')).toBeVisible();

  const titre = 'Rappels aux bénévoles par email';
  const carte = await ajouterTicket(page, titre, 'Un rappel la veille de chaque Lipapote.');
  await expect(carte).toBeVisible();
  await expect(carte.getByRole('button', { name: 'Déployer en prod' })).toHaveCount(0);

  await carte.getByRole('button', { name: 'Lancer la conception' }).click();
  const enConception = colonne(page, 'En conception').getByRole('article', { name: titre });
  await expect(enConception.getByText('Claude conçoit la maquette')).toBeVisible();
  await expect(enConception.getByRole('button', { name: 'Lancer le dev' })).toBeDisabled();
  await expect(enConception.getByText('Spec et maquette prêtes')).toBeVisible();

  await enConception.getByRole('button', { name: 'Voir le design' }).click();
  const fiche = page.getByRole('dialog', { name: titre });
  await expect(fiche.getByRole('heading', { name: 'Écrans' })).toBeVisible();
  await expect(fiche.frameLocator('iframe[title="Maquette du ticket"]').getByRole('heading', { name: titre })).toBeVisible();
  await expect(fiche.getByRole('link', { name: 'Ouvrir la maquette en plein écran' })).toHaveAttribute('href', /^\/api\/tickets\/\d+\/maquette/);
  await expect(fiche.getByRole('link', { name: 'Voir le fichier source' })).toHaveAttribute('href', /^https:\/\/maquette\.exemple\.test\//);
  await fiche.getByRole('tab', { name: 'Spec' }).click();
  await expect(fiche.getByRole('heading', { name: 'Exigences indispensables' })).toBeVisible();
  await fiche.getByRole('button', { name: 'Fermer' }).click();

  await enConception.getByRole('button', { name: 'Lancer le dev' }).click();
  const enDev = colonne(page, 'En dev').getByRole('article', { name: titre });
  await expect(enDev.getByText(/Branche claude\/\d+-rappels-aux-benevoles-par-email/)).toBeVisible();

  const enTest = colonne(page, 'En test').getByRole('article', { name: titre });
  await expect(enTest.getByText('Préprod à jour')).toBeVisible({ timeout: 15_000 });
  await expect(enTest.getByText('3 scénarios à réaliser, aucun encore fait.')).toBeVisible();

  await enTest.getByRole('button', { name: 'Ouvrir les scénarios' }).click();
  await fiche.getByRole('checkbox', { name: 'Cas nominal' }).check();
  await fiche.getByRole('button', { name: 'Fermer' }).click();
  await expect(enTest.getByText('3 scénarios à réaliser, 1 déjà fait.')).toBeVisible();

  await enTest.getByRole('button', { name: 'Déployer en prod' }).click();
  const confirmation = page.getByRole('dialog', { name: 'Déployer en prod ?' });
  await confirmation.getByRole('button', { name: 'Annuler' }).click();
  await expect(enTest).toBeVisible();

  await enTest.getByRole('button', { name: 'Déployer en prod' }).click();
  await confirmation.getByRole('button', { name: 'Oui, déployer en prod' }).click();

  const done = colonne(page, 'Done').getByRole('article', { name: titre });
  await expect(done.getByText(/Optivie, en ligne le \d+ \S+/)).toBeVisible({ timeout: 15_000 });

  await done.getByRole('button', { name: titre }).click();
  await fiche.getByRole('tab', { name: 'Journal' }).click();
  await expect(fiche.getByText('Passage de Déploiement en prod à Done.')).toBeVisible();
});

test('quota atteint : bandeau, ticket bloqué, reprise seulement par Relancer', async ({ page }) => {
  await page.goto('/');
  const titre = 'Export des bénévoles en CSV';
  const carte = await ajouterTicket(page, titre, 'Export pour la trésorière #simu:quota');
  await carte.getByRole('button', { name: 'Lancer la conception' }).click();

  const bloquee = colonne(page, 'En conception').getByRole('article', { name: `${titre}, bloqué` });
  await expect(bloquee.getByText('Bloqué : Quota Claude atteint.')).toBeVisible();
  await expect(page.getByText('Quota Claude épuisé.')).toBeVisible();
  await expect(page.getByText('Quota Claude de la semaine : épuisé')).toBeVisible();

  await page.waitForTimeout(1000);
  await expect(bloquee).toBeVisible();

  await bloquee.getByRole('button', { name: 'Relancer' }).click();
  await expect(colonne(page, 'En conception').getByRole('article', { name: titre }).getByText('Spec prête')).toBeVisible();
  await expect(page.getByText('Quota Claude épuisé.')).toBeHidden();
});

test('glisser une carte déclenche les décisions manuelles, et seulement elles', async ({ page }) => {
  await page.goto('/');
  const titre = 'Carte à glisser';
  const carte = await ajouterTicket(page, titre, 'Pour le glisser-déposer');

  // Saut de colonne : le message s'affiche au survol, la carte reste en place.
  await carte.hover();
  await page.mouse.down();
  await colonne(page, 'En dev').hover();
  await colonne(page, 'En dev').hover({ position: { x: 40, y: 400 } });
  await expect(colonne(page, 'En dev').getByRole('status')).toHaveText('Un ticket ne saute pas de colonne : il avance une étape à la fois.');
  await page.mouse.up();
  await expect(colonne(page, 'Backlog').getByRole('article', { name: titre })).toBeVisible();
  await expect(colonne(page, 'En dev').getByRole('status')).toHaveCount(0);

  // Backlog vers En conception : la conception démarre.
  await carte.dragTo(colonne(page, 'En conception'));
  const enConception = colonne(page, 'En conception').getByRole('article', { name: titre });
  await expect(enConception.getByText('Spec et maquette prêtes')).toBeVisible();

  // En conception vers En dev : le dev démarre.
  await enConception.dragTo(colonne(page, 'En dev'));
  const enTest = colonne(page, 'En test').getByRole('article', { name: titre });
  await expect(enTest.getByText('Préprod à jour')).toBeVisible({ timeout: 15_000 });

  // En test vers Déploiement en prod : la confirmation est obligatoire.
  await enTest.dragTo(colonne(page, 'Déploiement en prod'));
  const confirmation = page.getByRole('dialog', { name: 'Déployer en prod ?' });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Annuler' }).click();
  await expect(enTest).toBeVisible();
});

test('un ticket se supprime hors du backlog quand aucun run ne tourne', async ({ page }) => {
  await page.goto('/');
  const titre = 'Ticket à abandonner';
  await ajouterTicket(page, titre, 'Plus utile');
  await colonne(page, 'Backlog').getByRole('article', { name: titre }).dragTo(colonne(page, 'En conception'));
  const enConception = colonne(page, 'En conception').getByRole('article', { name: titre });

  // Pendant la rédaction de la spec, ni modifier ni supprimer.
  await enConception.getByRole('button', { name: titre }).click();
  const fiche = page.getByRole('dialog', { name: titre });
  await expect(fiche.getByRole('button', { name: 'Supprimer' })).toHaveCount(0);
  await expect(fiche.getByRole('button', { name: 'Modifier' })).toHaveCount(0);

  // Une fois spec et maquette prêtes, la suppression redevient possible, la modification non.
  await expect(fiche.getByRole('button', { name: 'Supprimer' })).toBeVisible({ timeout: 15_000 });
  await expect(fiche.getByRole('button', { name: 'Modifier' })).toHaveCount(0);
  await fiche.getByRole('button', { name: 'Supprimer' }).click();
  const confirmation = page.getByRole('dialog', { name: 'Supprimer ce ticket ?' });
  await expect(confirmation.getByText('La branche GitHub et ce qui est déjà en ligne ne seront pas touchés.')).toBeVisible();
  await confirmation.getByRole('button', { name: 'Supprimer' }).click();
  await expect(page.getByRole('article', { name: titre })).toHaveCount(0);
});

test('le backlog se modifie et se supprime', async ({ page }) => {
  await page.goto('/');
  const carte = await ajouterTicket(page, 'Idée à jeter', 'Brouillon');
  await carte.getByRole('button', { name: 'Idée à jeter' }).click();
  const fiche = page.getByRole('dialog', { name: 'Idée à jeter' });
  await fiche.getByRole('button', { name: 'Supprimer' }).click();
  await page.getByRole('dialog', { name: 'Supprimer ce ticket ?' }).getByRole('button', { name: 'Supprimer' }).click();
  await expect(page.getByRole('article', { name: 'Idée à jeter' })).toHaveCount(0);
});

test('la spec et le design se corrigent à la main depuis la fiche, sans changer de colonne', async ({ page }) => {
  await page.goto('/');
  const titre = 'Correction à la main du design';
  const carte = await ajouterTicket(page, titre, 'Retravailler la maquette ailleurs, puis corriger la fiche.');
  await carte.getByRole('button', { name: 'Lancer la conception' }).click();
  const enConception = colonne(page, 'En conception').getByRole('article', { name: titre });
  await expect(enConception.getByText('Spec et maquette prêtes')).toBeVisible({ timeout: 15_000 });

  await enConception.getByRole('button', { name: 'Voir le design' }).click();
  const fiche = page.getByRole('dialog', { name: titre });
  await expect(fiche.getByText('Version 1')).toBeVisible();

  // Un lien en http est refusé par le serveur : le message s'affiche et le texte saisi reste là.
  await fiche.getByRole('button', { name: 'Modifier' }).click();
  const resume = fiche.getByLabel('Résumé du design en markdown');
  await expect(resume).not.toHaveValue('');
  await resume.fill('# Écrans retravaillés\n\nLa maquette a été reprise sur Claude Design.');
  await fiche.getByLabel('Lien de la maquette').fill('http://maquette.exemple.test/refusee.html');
  await fiche.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(fiche.getByRole('alert')).toHaveText('Le lien de la maquette doit être une adresse https valide.');
  await expect(resume).toHaveValue(/La maquette a été reprise/);

  const nouveauLien = 'https://claude.ai/design/maquette-retravaillee';
  await fiche.getByLabel('Lien de la maquette').fill(nouveauLien);
  await fiche.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(fiche.getByText('Version 2')).toBeVisible();
  await expect(fiche.getByRole('heading', { name: 'Écrans retravaillés' })).toBeVisible();
  await expect(fiche.getByRole('link', { name: 'Ouvrir la maquette' })).toHaveAttribute('href', nouveauLien);

  // Annuler ne change rien, Échap annule l'édition sans fermer la fiche.
  await fiche.getByRole('button', { name: 'Modifier' }).click();
  await fiche.getByLabel('Résumé du design en markdown').fill('Brouillon abandonné');
  await page.keyboard.press('Escape');
  await expect(fiche).toBeVisible();
  await expect(fiche.getByLabel('Résumé du design en markdown')).toHaveCount(0);
  await expect(fiche.getByText('Version 2')).toBeVisible();
  await expect(fiche.getByText('Brouillon abandonné')).toHaveCount(0);

  // La spec se corrige de la même façon.
  await fiche.getByRole('tab', { name: 'Spec' }).click();
  await expect(fiche.getByText('Version 1')).toBeVisible();
  await fiche.getByRole('button', { name: 'Modifier' }).click();
  await fiche.getByLabel('Spec en markdown').fill('# Spec revue à la main\n\nUne exigence de plus.');
  await fiche.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(fiche.getByText('Version 2')).toBeVisible();
  await expect(fiche.getByRole('heading', { name: 'Spec revue à la main' })).toBeVisible();

  // Le journal garde la trace des deux corrections.
  await fiche.getByRole('tab', { name: 'Journal' }).click();
  await expect(fiche.getByText('Design modifié à la main (version 2).')).toBeVisible();
  await expect(fiche.getByText('Spec modifiée à la main (version 2).')).toBeVisible();

  // Le ticket n'a pas changé de colonne.
  await fiche.getByRole('button', { name: 'Fermer' }).click();
  await expect(colonne(page, 'En conception').getByRole('article', { name: titre })).toBeVisible();
});

test('un commentaire sur la spec attend le prochain run, puis il est transmis à Claude', async ({ page }) => {
  await page.goto('/');
  const titre = 'Commentaires sur la spec';
  const carte = await ajouterTicket(page, titre, 'Un retour avant la rédaction de la spec.');

  await carte.getByRole('button', { name: titre }).click();
  const fiche = page.getByRole('dialog', { name: titre });
  await fiche.getByRole('tab', { name: /^Commentaires/ }).click();
  await expect(fiche.getByText('Aucun commentaire pour l’instant.')).toBeVisible();

  // Le bouton reste inactif tant que le champ est vide.
  await expect(fiche.getByRole('button', { name: 'Envoyer' })).toBeDisabled();
  await fiche.getByLabel('Sujet').selectOption({ label: 'Spec' });
  await fiche.getByLabel('Ton commentaire').fill('Prévoir le cas des bénévoles sans email.');
  await fiche.getByLabel('Ton commentaire').press('Control+Enter');
  await expect(fiche.getByText('Prévoir le cas des bénévoles sans email.')).toBeVisible();
  await expect(fiche.getByText('En attente du prochain run')).toBeVisible();
  await expect(fiche.getByLabel('Ton commentaire')).toHaveValue('');
  await fiche.getByRole('button', { name: 'Fermer' }).click();

  await carte.getByRole('button', { name: 'Lancer la conception' }).click();
  const enConception = colonne(page, 'En conception').getByRole('article', { name: titre });
  await enConception.getByRole('button', { name: titre }).click();
  await fiche.getByRole('tab', { name: /^Commentaires/ }).click();
  await expect(fiche.getByText(/^Transmis à Claude le/)).toBeVisible();
  await expect(fiche.getByRole('button', { name: 'Supprimer' })).toHaveCount(0);

  await fiche.getByRole('tab', { name: 'Journal' }).click();
  await expect(fiche.getByText('1 commentaire transmis à Claude.')).toBeVisible();
});

test('en conception, un commentaire sur le design relance aussitôt le design', async ({ page }) => {
  await page.goto('/');
  const titre = 'Relance du design par un commentaire';
  const carte = await ajouterTicket(page, titre, 'Un retour sur la maquette.');
  await carte.getByRole('button', { name: 'Lancer la conception' }).click();
  const enConception = colonne(page, 'En conception').getByRole('article', { name: titre });
  await expect(enConception.getByText('Spec et maquette prêtes')).toBeVisible({ timeout: 15_000 });

  await enConception.getByRole('button', { name: 'Voir le design' }).click();
  const fiche = page.getByRole('dialog', { name: titre });
  await expect(fiche.getByText('Version 1')).toBeVisible();
  await fiche.getByRole('button', { name: 'Commenter' }).click();
  await expect(fiche.getByLabel('Sujet')).toHaveValue('design');
  await fiche.getByLabel('Ton commentaire').fill('Le bouton principal doit être plus visible.');
  await fiche.getByRole('button', { name: 'Envoyer' }).click();
  await expect(fiche.getByText(/^Transmis à Claude le/)).toBeVisible();

  // Le mode simulé livre une nouvelle maquette : le design passe en version 2.
  await fiche.getByRole('tab', { name: 'Design' }).click();
  await expect(fiche.getByText('Version 2')).toBeVisible({ timeout: 15_000 });
  await fiche.getByRole('tab', { name: 'Journal' }).click();
  await expect(fiche.getByText('Claude retravaille le design avec vos commentaires.')).toBeVisible();
});

const colonneBugs = (page: Page, nom: string) => page.getByRole('region', { name: `Bugs, ${nom}`, exact: true });

test('un bug signalé va du backlog à Done sans conception', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Bugs', level: 2 })).toBeVisible();
  await expect(colonneBugs(page, 'En conception').getByText('Pas de spec pour un bug : la carte passe directement en dev.')).toBeVisible();

  await page.getByRole('button', { name: 'Signaler un bug' }).click();
  const fenetre = page.getByRole('dialog', { name: 'Signaler un bug' });
  const titre = 'Le bouton Envoyer reste grisé';
  await fenetre.getByLabel('Titre').fill(titre);
  await fenetre.getByLabel('Description').fill('Après le remplissage du formulaire d’inscription, le bouton reste grisé.');
  // Un autre projet que les parcours précédents, dont la préprod reste occupée par un ticket en test.
  await fenetre.getByLabel('Projet').selectOption({ label: 'Interface JDR' });
  await fenetre.getByRole('button', { name: 'Ajouter aux bugs' }).click();
  await expect(fenetre).toBeHidden();

  const carte = colonneBugs(page, 'Backlog').getByRole('article', { name: titre });
  await expect(carte.getByText('Signalé par vous')).toBeVisible();
  await expect(colonne(page, 'Backlog').getByRole('article', { name: titre })).toHaveCount(0);
  await expect(carte.getByRole('button', { name: 'Lancer la conception' })).toHaveCount(0);

  await carte.getByRole('button', { name: 'Lancer la correction' }).click();
  const enDev = colonneBugs(page, 'En dev').getByRole('article', { name: titre });
  await expect(enDev.getByText(/Branche claude\/\d+-le-bouton-envoyer-reste-grise/)).toBeVisible();

  const enTest = colonneBugs(page, 'En test').getByRole('article', { name: titre });
  await expect(enTest.getByText('2 scénarios à réaliser, aucun encore fait.')).toBeVisible({ timeout: 15_000 });

  await enTest.getByRole('button', { name: 'Ouvrir les scénarios' }).click();
  const fiche = page.getByRole('dialog', { name: titre });
  await expect(fiche.getByRole('tab', { name: 'Spec' })).toHaveCount(0);
  await expect(fiche.getByRole('checkbox', { name: 'Rejouer le bug' })).toBeVisible();
  await fiche.getByRole('button', { name: 'Fermer' }).click();

  await enTest.getByRole('button', { name: 'Déployer en prod' }).click();
  await page.getByRole('dialog', { name: 'Déployer en prod ?' }).getByRole('button', { name: 'Oui, déployer en prod' }).click();
  await expect(colonneBugs(page, 'Done').getByRole('article', { name: titre }).getByText(/corrigé le/)).toBeVisible({ timeout: 15_000 });
});
