import { describe, expect, it } from 'vitest';
import type { Projet, Run } from '../../src/serveur/base/depots';
import { QuotaAtteintErreur } from '../../src/serveur/relais/executeur';
import { BETA_ROUTINES, TAILLE_MAX_TEXTE, creerExecuteurReel, repriseDepuis, type EtapeClaude } from '../../src/serveur/relais/reel';
import { URL_MAQUETTE, ticket } from '../domaine/fixtures';

const JETON = 'sk-ant-oat01-jeton-secret-de-test';
const TACHES = Object.fromEntries(
  (['spec', 'design', 'dev'] as const).map((e) => [e, { url: `https://api.anthropic.com/v1/claude_code/routines/trig_${e}/fire`, jeton: `${JETON}-${e}` }]),
) as Record<EtapeClaude, { url: string; jeton: string }>;

const PROJET: Projet = { id: 1, nom: 'Optivie', depot: 'orphane-a/optivie', urlPreprod: 'https://preprod.optivie.orphane.fr', urlProd: null };
const MAINTENANT = Date.parse('2026-11-17T10:00:00.000Z');

function run(type: Run['type']): Run {
  return { id: `run-${type}`, ticketId: 12, type, statut: 'en_cours', urlSession: null, debut: '', derniereNouvelle: '', fin: null };
}

interface Appel {
  url: string;
  init: RequestInit;
}

function fauxFetch(reponse: () => Response | Promise<Response>) {
  const appels: Appel[] = [];
  const f = (async (url: string, init: RequestInit) => {
    appels.push({ url, init });
    return reponse();
  }) as unknown as typeof fetch;
  return { f, appels };
}

const json = (corps: unknown, status = 200, entetes: Record<string, string> = {}) =>
  new Response(JSON.stringify(corps), { status, headers: { 'content-type': 'application/json', ...entetes } });

const SUCCES = { type: 'routine_fire', claude_code_session_id: 'session_01', claude_code_session_url: 'https://claude.ai/code/session_01' };

function executeur(reponse: () => Response | Promise<Response> = () => json(SUCCES)) {
  const { f, appels } = fauxFetch(reponse);
  const e = creerExecuteurReel({ taches: TACHES, urlRelais: 'https://kanban.orphane.fr', fetch: f, maintenant: () => MAINTENANT });
  return { e, appels };
}

const pret = ticket({ colonne: 'conception', branche: 'claude/12-fiche-personnage', spec: '# Spec', design: '# Design', urlMaquette: URL_MAQUETTE });

async function erreurDe(promesse: Promise<unknown>): Promise<Error> {
  try {
    await promesse;
  } catch (e) {
    return e as Error;
  }
  throw new Error('aucune erreur levée');
}

describe('exécuteur réel : appel de /fire', () => {
  it('appelle la tâche de l’étape avec son jeton et les en têtes attendus', async () => {
    const { e, appels } = executeur();
    const r = await e.lancer({ run: run('design'), ticket: pret, projet: PROJET });
    expect(r).toEqual({ urlSession: 'https://claude.ai/code/session_01' });
    expect(appels).toHaveLength(1);
    expect(appels[0]!.url).toBe(TACHES.design.url);
    const entetes = appels[0]!.init.headers as Record<string, string>;
    expect(entetes.Authorization).toBe(`Bearer ${TACHES.design.jeton}`);
    expect(entetes['anthropic-version']).toBe('2023-06-01');
    expect(entetes['anthropic-beta']).toBe(BETA_ROUTINES);
    expect(appels[0]!.init.method).toBe('POST');
  });

  it('chaque étape a sa propre tâche', async () => {
    for (const etape of ['spec', 'design', 'dev'] as const) {
      const { e, appels } = executeur();
      await e.lancer({ run: run(etape), ticket: pret, projet: PROJET });
      expect(appels[0]!.url).toBe(TACHES[etape].url);
    }
  });

  it('transmet le ticket, le run, le dépôt et le webhook dans le champ text', async () => {
    const { e, appels } = executeur();
    await e.lancer({ run: run('dev'), ticket: pret, projet: PROJET });
    const corps = JSON.parse(String(appels[0]!.init.body)) as { text: string };
    expect(Object.keys(corps)).toEqual(['text']);
    const charge = JSON.parse(corps.text);
    expect(charge).toMatchObject({
      etape: 'dev',
      runId: 'run-dev',
      ticket: { id: 12, branche: 'claude/12-fiche-personnage', spec: '# Spec', design: '# Design', urlMaquette: URL_MAQUETTE, iterationMax: 5 },
      projet: { depot: 'orphane-a/optivie', urlPreprod: 'https://preprod.optivie.orphane.fr' },
      relais: { webhook: 'https://kanban.orphane.fr/relais/webhooks/claude' },
    });
  });

  it('n’envoie que le nécessaire : pas de spec à l’étape spec, pas de design avant le dev', async () => {
    const { e, appels } = executeur();
    await e.lancer({ run: run('spec'), ticket: pret, projet: PROJET });
    await e.lancer({ run: run('design'), ticket: pret, projet: PROJET });
    const [spec, design] = appels.map((a) => JSON.parse(JSON.parse(String(a.init.body)).text));
    expect(spec.ticket).not.toHaveProperty('spec');
    expect(design.ticket.spec).toBe('# Spec');
    expect(design.ticket).not.toHaveProperty('design');
  });

  it('accepte une réponse sans URL de session', async () => {
    const { e } = executeur(() => json({ type: 'routine_fire' }));
    expect(await e.lancer({ run: run('spec'), ticket: pret, projet: PROJET })).toEqual({});
  });
});

describe('exécuteur réel : refus et erreurs', () => {
  it('429 devient « Quota Claude atteint » avec l’heure de reprise', async () => {
    const { e } = executeur(() => json({ type: 'error', error: { type: 'rate_limit_error', message: 'x' } }, 429, { 'retry-after': '1800' }));
    const erreur = await erreurDe(e.lancer({ run: run('spec'), ticket: pret, projet: PROJET }));
    expect(erreur).toBeInstanceOf(QuotaAtteintErreur);
    expect((erreur as QuotaAtteintErreur).repriseEstimee).toBe('2026-11-17T10:30:00.000Z');
  });

  it.each([
    [400, 'en pause'],
    [401, 'jeton'],
    [403, 'accès'],
    [404, 'introuvable'],
    [500, 'erreur'],
    [503, 'surchargé'],
  ])('%i donne un message clair, sans jamais révéler le jeton', async (status, attendu) => {
    const { e } = executeur(() => json({ type: 'error', error: { type: 'x', message: 'détail du service' } }, status));
    const erreur = await erreurDe(e.lancer({ run: run('spec'), ticket: pret, projet: PROJET }));
    expect(erreur).not.toBeInstanceOf(QuotaAtteintErreur);
    expect(erreur.message).toContain(attendu);
    expect(erreur.message).toContain('détail du service');
    expect(erreur.message).not.toContain(JETON);
  });

  it('une coupure réseau n’est jamais retentée : un seul appel', async () => {
    const { e, appels } = executeur(() => {
      throw new TypeError('fetch failed');
    });
    const erreur = await erreurDe(e.lancer({ run: run('spec'), ticket: pret, projet: PROJET }));
    expect(erreur.message).toContain('injoignable');
    expect(appels).toHaveLength(1);
  });

  it('un délai dépassé invite à vérifier sur claude.ai avant de relancer', async () => {
    const { e } = executeur(() => {
      throw new DOMException('timeout', 'TimeoutError');
    });
    expect((await erreurDe(e.lancer({ run: run('spec'), ticket: pret, projet: PROJET }))).message).toContain('aucune session');
  });

  it('refuse sans projet ou sans dépôt, sans appeler la tâche', async () => {
    const { e, appels } = executeur();
    expect((await erreurDe(e.lancer({ run: run('spec'), ticket: pret, projet: null }))).message).toContain('aucun projet');
    expect((await erreurDe(e.lancer({ run: run('spec'), ticket: pret, projet: { ...PROJET, depot: null } }))).message).toContain('dépôt');
    expect(appels).toHaveLength(0);
  });

  it('refuse une demande trop longue pour /fire', async () => {
    const { e, appels } = executeur();
    const long = { ...pret, spec: 'x'.repeat(TAILLE_MAX_TEXTE) };
    expect((await erreurDe(e.lancer({ run: run('design'), ticket: long, projet: PROJET }))).message).toContain('Raccourcissez');
    expect(appels).toHaveLength(0);
  });

  it('ne lance jamais le déploiement par une tâche Claude', async () => {
    const { e, appels } = executeur();
    await erreurDe(e.lancer({ run: run('deploiement'), ticket: pret, projet: PROJET }));
    expect(appels).toHaveLength(0);
  });
});

describe('Retry-After', () => {
  it('lit des secondes ou une date HTTP', () => {
    expect(repriseDepuis('60', MAINTENANT)).toBe('2026-11-17T10:01:00.000Z');
    expect(repriseDepuis('Tue, 17 Nov 2026 12:00:00 GMT', MAINTENANT)).toBe('2026-11-17T12:00:00.000Z');
    expect(repriseDepuis(null, MAINTENANT)).toBe(null);
    expect(repriseDepuis('demain', MAINTENANT)).toBe(null);
  });
});
