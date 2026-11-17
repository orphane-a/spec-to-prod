import { creerApp } from '../../src/serveur/app';
import type { DemandeRun, Executeur, ReponseLancement } from '../../src/serveur/relais/executeur';

/** Exécuteur de test : enregistre les demandes et se comporte comme on le lui dit. */
export class ExecuteurEspion implements Executeur {
  demandes: DemandeRun[] = [];
  comportement: () => Promise<ReponseLancement> = async () => ({ urlSession: 'https://claude.ai/code/session-test' });

  async lancer(demande: DemandeRun): Promise<ReponseLancement> {
    this.demandes.push(demande);
    return this.comportement();
  }

  dernierRun() {
    const d = this.demandes.at(-1);
    if (!d) throw new Error('Aucun run lancé');
    return d.run;
  }
}

export const SECRET_TEST = 'secret-de-test-'.padEnd(40, 'x');

export function creerAppTest() {
  const claude = new ExecuteurEspion();
  const deploiement = new ExecuteurEspion();
  let instant = Date.parse('2026-11-17T10:00:00.000Z');
  // Horloge qui avance d'une seconde à chaque lecture : ordre du journal déterministe.
  const horloge = () => new Date((instant += 1000)).toISOString();
  const app = creerApp({
    config: { BASE_CHEMIN: ':memory:', ITERATIONS_MAX: 5, WEBHOOK_SECRET: SECRET_TEST },
    executeurs: { claude, deploiement },
    horloge,
  });
  return { ...app, claude, deploiement };
}

export type AppTest = ReturnType<typeof creerAppTest>;

export async function creerTicket(app: AppTest, saisie: Record<string, unknown> = {}) {
  const r = await app.serveur.inject({
    method: 'POST',
    url: '/api/tickets',
    payload: { titre: 'Planning des bénévoles', description: 'Voir qui est disponible.', projetId: 3, ...saisie },
  });
  return r.json();
}

export function agir(app: AppTest, id: number, action: string, payload?: unknown) {
  return app.serveur.inject({ method: 'POST', url: `/api/tickets/${id}/actions/${action}`, payload: payload as object });
}

export const TOUT_VERT = { unitaires: 'vert', non_regression: 'vert', exploratoire: 'vert' } as const;
export const SCENARIOS = [
  { objectif: 'Cas nominal', etapes: 'Ouvrir le planning', resultatAttendu: 'Le planning s’affiche' },
  { objectif: 'Cas d’erreur', etapes: 'Choisir une date passée', resultatAttendu: 'Un message explique le refus' },
];
