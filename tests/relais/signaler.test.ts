import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { envoyer, signer as signerScript } from '../../taches-cloud/signaler.mjs';
import { signer } from '../../src/serveur/relais/signature';
import { SECRET_TEST, agir, creerAppTest, creerTicket, type AppTest } from '../api/outils';

/**
 * Le script lancé par les sessions cloud doit parler exactement le langage du relais :
 * même signature, même format, vrai serveur HTTP.
 */
let app: AppTest;
afterEach(async () => app?.serveur.close());

async function demarrer() {
  app = creerAppTest();
  await app.serveur.listen({ port: 0, host: '127.0.0.1' });
  const adresse = app.serveur.server.address();
  if (!adresse || typeof adresse === 'string') throw new Error('adresse inconnue');
  return `http://127.0.0.1:${adresse.port}/relais/webhooks/claude`;
}

describe('script de signalement des sessions cloud', () => {
  it('signe comme le relais', () => {
    expect(signerScript('{"a":1}', SECRET_TEST)).toBe(signer('{"a":1}', SECRET_TEST));
  });

  it('fait avancer le ticket par le vrai webhook', async () => {
    const url = await demarrer();
    const { id } = await creerTicket(app);
    await agir(app, id, 'lancer-conception');
    const runId = app.claude.dernierRun().id;

    const r = await envoyer(url, { runId, evenement: { type: 'SPEC_PRETE', spec: '# Spec du script' } }, SECRET_TEST, { essais: 1 });
    expect(r).toMatchObject({ ok: true, statut: 200 });
    expect(app.service.lire(id)).toMatchObject({ spec: '# Spec du script', runEnCours: 'design' });
  });

  it('un mauvais secret est refusé sans nouvel essai', async () => {
    const url = await demarrer();
    const r = await envoyer(url, { runId: 'x', evenement: { type: 'ECHEC', motif: 'x' } }, 'mauvais-secret', { essais: 3, pauseMs: 1 });
    expect(r).toMatchObject({ ok: false, statut: 401 });
  });

  it('réessaie quand le relais est injoignable', async () => {
    const debut = Date.now();
    const r = await envoyer('http://127.0.0.1:1/relais/webhooks/claude', { runId: 'x' }, SECRET_TEST, { essais: 2, pauseMs: 5 });
    expect(r.ok).toBe(false);
    expect(Date.now() - debut).toBeGreaterThanOrEqual(5);
  });

  it('en ligne de commande, refuse de partir sans secret', async () => {
    const dossier = mkdtempSync(join(tmpdir(), 'signaler-'));
    const fichier = join(dossier, 'corps.json');
    writeFileSync(fichier, JSON.stringify({ runId: 'x', evenement: { type: 'ECHEC', motif: 'x' } }));
    const env = { ...process.env };
    delete env.SPEC_TO_PROD_SECRET;
    const erreur = await promisify(execFile)(process.execPath, ['taches-cloud/signaler.mjs', 'http://127.0.0.1:1/x', fichier], { env }).catch((e: { code: number; stderr: string }) => e);
    expect(erreur).toMatchObject({ code: 2 });
    expect((erreur as { stderr: string }).stderr).toContain('SPEC_TO_PROD_SECRET');
  });
});
