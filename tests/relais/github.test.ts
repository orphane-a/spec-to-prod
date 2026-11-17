import { describe, expect, it } from 'vitest';
import type { Projet, Run } from '../../src/serveur/base/depots';
import { FICHIER_PIPELINE, creerExecuteurPipeline } from '../../src/serveur/relais/github';
import { ticket } from '../domaine/fixtures';

const JETON = 'github_pat_jeton_secret_de_test';
const OPTIVIE: Projet = { id: 3, nom: 'Optivie', depot: 'orphane-a/optivie', urlPreprod: null, urlProd: null, branchePrincipale: 'master' };
const pret = ticket({ id: 12, colonne: 'dev', branche: 'claude/12-fiche-personnage' });

function run(type: Run['type']): Run {
  return { id: `run-${type}`, ticketId: 12, type, statut: 'en_cours', urlSession: null, debut: '', derniereNouvelle: '', fin: null };
}

function executeur(reponse: () => Response = () => new Response(null, { status: 204 })) {
  const appels: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    appels.push({ url, init });
    return reponse();
  }) as unknown as typeof fetch;
  return { e: creerExecuteurPipeline({ jeton: JETON, urlRelais: 'https://kanban.orphane.fr', fetch: f }), appels };
}

async function erreurDe(promesse: Promise<unknown>): Promise<Error> {
  try {
    await promesse;
  } catch (e) {
    return e as Error;
  }
  throw new Error('aucune erreur levée');
}

describe('lancement du pipeline GitHub du projet', () => {
  it('lance spec-to-prod.yml sur la branche principale, avec les entrées de la préprod', async () => {
    const { e, appels } = executeur();
    const r = await e.lancer({ run: run('preprod'), ticket: pret, projet: OPTIVIE });
    expect(appels).toHaveLength(1);
    expect(appels[0]!.url).toBe(`https://api.github.com/repos/orphane-a/optivie/actions/workflows/${FICHIER_PIPELINE}/dispatches`);
    const entetes = appels[0]!.init.headers as Record<string, string>;
    expect(entetes.Authorization).toBe(`Bearer ${JETON}`);
    expect(entetes['X-GitHub-Api-Version']).toBe('2022-11-28');
    expect(JSON.parse(String(appels[0]!.init.body))).toEqual({
      ref: 'master',
      inputs: {
        environnement: 'preprod',
        branche: 'claude/12-fiche-personnage',
        ticket: '12',
        run_id: 'run-preprod',
        webhook: 'https://kanban.orphane.fr/relais/webhooks/pipeline',
      },
    });
    expect(r.urlSession).toBe('https://github.com/orphane-a/optivie/actions/workflows/spec-to-prod.yml');
  });

  it('la prod passe environnement=prod', async () => {
    const { e, appels } = executeur();
    await e.lancer({ run: run('deploiement'), ticket: pret, projet: OPTIVIE });
    expect(JSON.parse(String(appels[0]!.init.body)).inputs.environnement).toBe('prod');
  });

  it.each([
    [401, 'jeton GitHub est refusé'],
    [403, 'Actions en écriture'],
    [404, 'spec-to-prod.yml doit être présent sur la branche master'],
    [422, 'workflow_dispatch'],
    [500, 'GitHub a répondu 500'],
  ])('%i donne un message clair, sans jamais révéler le jeton', async (status, attendu) => {
    const { e } = executeur(() => Response.json({ message: 'détail GitHub' }, { status }));
    const erreur = await erreurDe(e.lancer({ run: run('preprod'), ticket: pret, projet: OPTIVIE }));
    expect(erreur.message).toContain(attendu);
    expect(erreur.message).toContain('détail GitHub');
    expect(erreur.message).not.toContain(JETON);
  });

  it('une coupure réseau n’est jamais retentée', async () => {
    const { e, appels } = executeur(() => {
      throw new TypeError('fetch failed');
    });
    expect((await erreurDe(e.lancer({ run: run('preprod'), ticket: pret, projet: OPTIVIE }))).message).toContain('injoignable');
    expect(appels).toHaveLength(1);
  });

  it('refuse sans projet, sans dépôt, sans branche ou pour une étape Claude, sans appeler GitHub', async () => {
    const { e, appels } = executeur();
    await erreurDe(e.lancer({ run: run('preprod'), ticket: pret, projet: null }));
    await erreurDe(e.lancer({ run: run('preprod'), ticket: pret, projet: { ...OPTIVIE, depot: null } }));
    await erreurDe(e.lancer({ run: run('preprod'), ticket: { ...pret, branche: null }, projet: OPTIVIE }));
    await erreurDe(e.lancer({ run: run('dev'), ticket: pret, projet: OPTIVIE }));
    expect(appels).toHaveLength(0);
  });
});
