import { expect, test, type Page } from '@playwright/test';

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
  await expect(fiche.getByRole('link', { name: 'Ouvrir la maquette' })).toHaveAttribute('href', /^https:\/\/maquette\.exemple\.test\//);
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

test('le backlog se modifie et se supprime, pas les autres colonnes', async ({ page }) => {
  await page.goto('/');
  const carte = await ajouterTicket(page, 'Idée à jeter', 'Brouillon');
  await carte.getByRole('button', { name: 'Idée à jeter' }).click();
  const fiche = page.getByRole('dialog', { name: 'Idée à jeter' });
  await fiche.getByRole('button', { name: 'Supprimer' }).click();
  await page.getByRole('dialog', { name: 'Supprimer ce ticket ?' }).getByRole('button', { name: 'Supprimer' }).click();
  await expect(page.getByRole('article', { name: 'Idée à jeter' })).toHaveCount(0);
});
