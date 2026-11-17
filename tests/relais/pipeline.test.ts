import { afterEach, describe, expect, it } from 'vitest';
import { attendreVersion, memeVersion, signaler } from '../../taches-cloud/pipeline.mjs';
import { SECRET_TEST, agir, creerAppTest, creerTicket, SCENARIOS, TOUT_VERT, type AppTest } from '../api/outils';

/** L'outil des pipelines des projets doit parler exactement le langage du relais. */
let app: AppTest;
afterEach(async () => app?.serveur.close());

async function demarrer() {
  app = creerAppTest();
  await app.serveur.listen({ port: 0, host: '127.0.0.1' });
  const adresse = app.serveur.server.address();
  if (!adresse || typeof adresse === 'string') throw new Error('adresse inconnue');
  return `http://127.0.0.1:${adresse.port}`;
}

async function ticketEnPreprod() {
  const { id } = await creerTicket(app);
  await agir(app, id, 'lancer-conception');
  await app.service.recevoir(app.claude.dernierRun().id, { type: 'SPEC_PRETE', spec: '# Spec' });
  await app.service.recevoir(app.claude.dernierRun().id, { type: 'DESIGN_PRET', resume: '# D', urlMaquette: 'https://github.com/o/r/blob/b/m.html' });
  await agir(app, id, 'lancer-dev');
  await app.service.recevoir(app.claude.dernierRun().id, { type: 'DEV_TERMINE', controles: TOUT_VERT, scenarios: SCENARIOS });
  return { id, runId: app.deploiement.dernierRun().id };
}

describe('outil des pipelines : signaler', () => {
  it('fait passer le ticket en test par le vrai webhook du pipeline', async () => {
    const base = await demarrer();
    const { id, runId } = await ticketEnPreprod();
    const env = { WEBHOOK: `${base}/relais/webhooks/pipeline`, RUN_ID: runId, SPEC_TO_PROD_SECRET: SECRET_TEST, SPEC_TO_PROD_URL: base };
    await signaler('PREPROD_DEPLOYEE', { urlPreprod: 'https://preprod.optivie.orphane.fr', version: 'a1b2c3d' }, env, { essais: 1 });
    expect(app.service.lire(id)).toMatchObject({ colonne: 'test', urlPreprod: 'https://preprod.optivie.orphane.fr' });
  });

  it('refuse un webhook qui ne commence pas par l’adresse attendue du kanban', async () => {
    const env = { WEBHOOK: 'https://ailleurs.exemple/relais/webhooks/pipeline', RUN_ID: 'x', SPEC_TO_PROD_SECRET: SECRET_TEST, SPEC_TO_PROD_URL: 'https://kanban.orphane.fr' };
    await expect(signaler('ECHEC', { motif: 'x' }, env)).rejects.toThrow('Webhook refusé');
  });

  it('échoue clairement quand le relais refuse', async () => {
    const base = await demarrer();
    const env = { WEBHOOK: `${base}/relais/webhooks/pipeline`, RUN_ID: 'inconnu', SPEC_TO_PROD_SECRET: SECRET_TEST };
    await expect(signaler('ECHEC', { motif: 'x' }, env, { essais: 1 })).rejects.toThrow('404');
  });
});

describe('outil des pipelines : attendre la version en ligne', () => {
  const reponses = (...corps: (string | null)[]) => {
    let i = 0;
    return (async () => {
      const c = corps[Math.min(i++, corps.length - 1)];
      return c === null ? new Response('indisponible', { status: 502 }) : new Response(c, { status: 200 });
    }) as unknown as typeof fetch;
  };
  const silencieux = () => {};

  it('attend que le champ JSON affiche le commit attendu', async () => {
    const fetcher = reponses(null, '{"statut":"ok","commit":"ancien000"}', '{"statut":"ok","commit":"a1b2c3d4e5f6"}');
    const r = await attendreVersion('https://preprod.exemple/api/sante', 'a1b2c3d4e5f6', { champ: 'commit', pauseMs: 1, fetcher, journal: silencieux });
    expect(r).toEqual({ ok: true, version: 'a1b2c3d4e5f6' });
  });

  it('lit un fichier texte de version', async () => {
    const r = await attendreVersion('https://preprod.exemple/version.txt', 'a1b2c3d', { pauseMs: 1, fetcher: reponses('a1b2c3d4e5f6\n'), journal: silencieux });
    expect(r.ok).toBe(true);
  });

  it('abandonne après le délai avec la dernière version lue', async () => {
    const r = await attendreVersion('https://preprod.exemple/api/sante', 'a1b2c3d', { champ: 'commit', minutes: 0, pauseMs: 1, fetcher: reponses('{"commit":"local"}'), journal: silencieux });
    expect(r).toEqual({ ok: false, version: 'local' });
  });

  it('compare commits courts et longs, sans confondre deux versions', () => {
    expect(memeVersion('a1b2c3d4e5f6', 'a1b2c3d')).toBe(true);
    expect(memeVersion('a1b2c3d', 'a1b2c3d4e5f6')).toBe(true);
    expect(memeVersion('local', 'a1b2c3d')).toBe(false);
    expect(memeVersion('', '')).toBe(false);
    expect(memeVersion('b1b2c3d4', 'a1b2c3d4')).toBe(false);
  });
});
