import { afterEach, describe, expect, it } from 'vitest';
import { creerApp, type App } from '../../src/serveur/app';
import { creerExecuteurReel, type EtapeClaude } from '../../src/serveur/relais/reel';
import { ExecuteurEspion, SECRET_TEST } from '../api/outils';

/** Les commentaires en attente partent dans la charge réellement envoyée à /fire, selon l'étape. */

const TACHES = Object.fromEntries(
  (['spec', 'design', 'dev'] as const).map((e) => [e, { url: `https://api.anthropic.com/v1/claude_code/routines/trig_${e}/fire`, jeton: `jeton-de-test-${e}` }]),
) as Record<EtapeClaude, { url: string; jeton: string }>;

interface Charge {
  etape: EtapeClaude;
  runId: string;
  ticket: { commentaires: { sujet: string; texte: string; le: string }[] };
}

let app: App;
let charges: Charge[];

afterEach(async () => app.serveur.close());

function demarrer() {
  charges = [];
  const faux = (async (_url: string, init: RequestInit) => {
    charges.push(JSON.parse((JSON.parse(String(init.body)) as { text: string }).text) as Charge);
    return new Response(JSON.stringify({ claude_code_session_url: `https://claude.ai/code/session_${charges.length}` }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  app = creerApp({
    config: { BASE_CHEMIN: ':memory:', ITERATIONS_MAX: 5, WEBHOOK_SECRET: SECRET_TEST },
    executeurs: { claude: creerExecuteurReel({ taches: TACHES, urlRelais: 'https://kanban.orphane.fr', fetch: faux }), deploiement: new ExecuteurEspion() },
  });
}

const commenter = (id: number, sujet: string, texte: string) =>
  app.serveur.inject({ method: 'POST', url: `/api/tickets/${id}/commentaires`, payload: { sujet, texte } });
const agir = (id: number, action: string) => app.serveur.inject({ method: 'POST', url: `/api/tickets/${id}/actions/${action}` });

describe('Commentaires dans la charge envoyée à la tâche cloud', () => {
  it('chaque étape reçoit seulement ses commentaires en attente', async () => {
    demarrer();
    const r = await app.serveur.inject({ method: 'POST', url: '/api/tickets', payload: { titre: 'Planning', description: 'Voir.', projetId: 3 } });
    const id = r.json().id as number;
    await commenter(id, 'spec', 'Ajouter les absences.');
    await commenter(id, 'design', 'Couleurs plus douces.');
    await agir(id, 'lancer-conception');

    expect(charges[0]!.ticket.commentaires).toEqual([{ sujet: 'spec', texte: 'Ajouter les absences.', le: expect.any(String) }]);

    await commenter(id, 'tests', 'Tester sur mobile.');
    await app.service.recevoir(charges[0]!.runId, { type: 'SPEC_PRETE', spec: '# Spec' });
    expect(charges[1]!.etape).toBe('design');
    expect(charges[1]!.ticket.commentaires.map((c) => c.texte)).toEqual(['Couleurs plus douces.']);

    await app.service.recevoir(charges[1]!.runId, { type: 'DESIGN_PRET', resume: '# Design', urlMaquette: 'https://github.com/o/r/blob/b/m.html' });
    await agir(id, 'lancer-dev');
    expect(charges[2]!.etape).toBe('dev');
    expect(charges[2]!.ticket.commentaires.map((c) => c.texte)).toEqual(['Tester sur mobile.']);
  });

  it('envoie une liste vide quand rien n’attend', async () => {
    demarrer();
    const r = await app.serveur.inject({ method: 'POST', url: '/api/tickets', payload: { titre: 'Planning', description: 'Voir.', projetId: 3 } });
    await agir(r.json().id, 'lancer-conception');
    expect(charges[0]!.ticket.commentaires).toEqual([]);
  });
});
