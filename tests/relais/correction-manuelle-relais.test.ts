import { afterEach, describe, expect, it } from 'vitest';
import { creerApp, type App } from '../../src/serveur/app';
import { creerExecuteurReel, type EtapeClaude } from '../../src/serveur/relais/reel';
import { ExecuteurEspion, SECRET_TEST } from '../api/outils';

/**
 * La session de dev lit la spec et le design dans la charge envoyée à /fire.
 * On passe ici par l'exécuteur réel avec un faux fetch : c'est la charge réellement envoyée qui est vérifiée.
 */

const TACHES = Object.fromEntries(
  (['spec', 'design', 'dev'] as const).map((e) => [e, { url: `https://api.anthropic.com/v1/claude_code/routines/trig_${e}/fire`, jeton: `jeton-de-test-${e}` }]),
) as Record<EtapeClaude, { url: string; jeton: string }>;

const URL_MAQUETTE = 'https://github.com/o/r/blob/b/m.html';
const NOUVELLE_URL = 'https://claude.ai/design/maquette-retravaillee';

interface Charge {
  etape: EtapeClaude;
  runId: string;
  ticket: { id: number; branche: string; spec?: string; design?: string; urlMaquette?: string };
}

let app: App;
let charges: Charge[];

afterEach(async () => app.serveur.close());

function demarrer() {
  charges = [];
  const faux = (async (_url: string, init: RequestInit) => {
    const corps = JSON.parse(String(init.body)) as { text: string };
    charges.push(JSON.parse(corps.text) as Charge);
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

async function creerTicketDeTest(): Promise<number> {
  const r = await app.serveur.inject({ method: 'POST', url: '/api/tickets', payload: { titre: 'Planning des bénévoles', description: 'Voir qui est disponible.', projetId: 3 } });
  return r.json().id as number;
}

const agir = (id: number, action: string) => app.serveur.inject({ method: 'POST', url: `/api/tickets/${id}/actions/${action}` });

async function ticketEnConception(): Promise<number> {
  demarrer();
  const id = await creerTicketDeTest();
  await agir(id, 'lancer-conception');
  await app.service.recevoir(charges.at(-1)!.runId, { type: 'SPEC_PRETE', spec: '# Spec de départ' });
  await app.service.recevoir(charges.at(-1)!.runId, { type: 'DESIGN_PRET', resume: '# Design de départ', urlMaquette: URL_MAQUETTE });
  expect(charges.map((c) => c.etape)).toEqual(['spec', 'design']);
  return id;
}

function corriger(id: number) {
  app.service.corrigerSpec(id, { spec: '# Spec corrigée à la main' });
  app.service.corrigerDesign(id, { design: '# Design corrigé à la main', urlMaquette: NOUVELLE_URL });
}

describe('relais : la session de dev reçoit les textes corrigés', () => {
  it('Lancer le dev envoie la spec, le design et le lien modifiés', async () => {
    const id = await ticketEnConception();
    corriger(id);
    await agir(id, 'lancer-dev');

    const charge = charges.at(-1)!;
    expect(charge.etape).toBe('dev');
    expect(charge.ticket).toMatchObject({ id, spec: '# Spec corrigée à la main', design: '# Design corrigé à la main', urlMaquette: NOUVELLE_URL });
    expect(JSON.stringify(charge)).not.toContain('de départ');
    expect(JSON.stringify(charge)).not.toContain(URL_MAQUETTE);
  });

  it('Relancer un ticket bloqué en dev envoie aussi les textes modifiés, sur la même branche', async () => {
    const id = await ticketEnConception();
    await agir(id, 'lancer-dev');
    const premiere = charges.at(-1)!;
    expect(premiere.ticket.spec).toBe('# Spec de départ');
    await app.service.recevoir(premiere.runId, { type: 'ECHEC', motif: 'Les tests ne passent pas.' });

    corriger(id);
    await agir(id, 'relancer');

    const relance = charges.at(-1)!;
    expect(relance.runId).not.toBe(premiere.runId);
    expect(relance.etape).toBe('dev');
    expect(relance.ticket).toMatchObject({ spec: '# Spec corrigée à la main', design: '# Design corrigé à la main', urlMaquette: NOUVELLE_URL, branche: premiere.ticket.branche });
  });
});
