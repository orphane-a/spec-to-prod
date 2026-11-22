import { describe, expect, it } from 'vitest';
import { resultatDepot } from '../../src/domaine/glisser-deposer';
import { transition } from '../../src/domaine/machine-etats';
import { COLONNES, type Colonne, type Ticket } from '../../src/domaine/types';
import { CTX, MAINTENANT, URL_MAQUETTE, ticket } from './fixtures';

/** Ticket prêt pour la décision manuelle de sa colonne. */
const pret: Record<Colonne, Ticket> = {
  backlog: ticket({ colonne: 'backlog' }),
  conception: ticket({ colonne: 'conception', spec: '# Spec', specVersion: 1, design: '# Design', urlMaquette: URL_MAQUETTE, designVersion: 1 }),
  dev: ticket({ colonne: 'dev', runEnCours: 'dev' }),
  test: ticket({ colonne: 'test' }),
  deploiement: ticket({ colonne: 'deploiement', runEnCours: 'deploiement' }),
  done: ticket({ colonne: 'done' }),
};

/** Table de vérité écrite à la main : seuls ces trois dépôts sont acceptés. */
const ACCEPTES: Partial<Record<Colonne, { vers: Colonne; action: string }>> = {
  backlog: { vers: 'conception', action: 'LANCER_CONCEPTION' },
  conception: { vers: 'dev', action: 'LANCER_DEV' },
  test: { vers: 'deploiement', action: 'DEPLOYER_PROD' },
};

describe('matrice des dépôts', () => {
  for (const depuis of COLONNES) {
    for (const vers of COLONNES) {
      const accepte = ACCEPTES[depuis]?.vers === vers;
      const attendu = depuis === vers ? 'même colonne' : accepte ? 'accepté' : 'refusé';
      it(`${depuis} vers ${vers} : ${attendu}`, () => {
        const r = resultatDepot(pret[depuis], vers);
        if (depuis === vers) expect(r).toEqual({ type: 'meme_colonne' });
        else if (accepte) expect(r).toEqual({ type: 'action', action: ACCEPTES[depuis]!.action });
        else {
          expect(r.type).toBe('refus');
          if (r.type === 'refus') expect(r.message.length).toBeGreaterThan(0);
        }
      });
    }
  }
});

describe('chaque dépôt accepté mène bien à la colonne visée', () => {
  for (const [depuis, { vers }] of Object.entries(ACCEPTES) as [Colonne, { vers: Colonne }][]) {
    it(`${depuis} vers ${vers}`, () => {
      const r = resultatDepot(pret[depuis], vers);
      if (r.type !== 'action') throw new Error('dépôt refusé');
      const evenement = r.action === 'DEPLOYER_PROD' ? { type: r.action, confirmation: true } : { type: r.action };
      const t = transition(pret[depuis], evenement, 'utilisatrice', CTX);
      expect(t.ok && t.ticket.colonne).toBe(vers);
    });
  }
});

describe('messages de refus', () => {
  it('retour en arrière', () => {
    expect(resultatDepot(pret.test, 'dev')).toEqual({ type: 'refus', message: 'Un ticket ne revient pas en arrière.' });
  });

  it('saut de colonne', () => {
    expect(resultatDepot(pret.backlog, 'dev')).toMatchObject({ type: 'refus', message: expect.stringContaining('ne saute pas') });
  });

  it('passage automatique', () => {
    expect(resultatDepot(pret.dev, 'test')).toMatchObject({ type: 'refus', message: expect.stringContaining('automatique') });
    expect(resultatDepot(pret.deploiement, 'done')).toMatchObject({ type: 'refus', message: expect.stringContaining('automatique') });
  });

  it('ticket terminé', () => {
    expect(resultatDepot(pret.done, 'backlog')).toMatchObject({ type: 'refus', message: expect.stringContaining('en ligne') });
  });

  it('spec absente', () => {
    const sansSpec = ticket({ colonne: 'conception', spec: null });
    expect(resultatDepot(sansSpec, 'dev')).toMatchObject({ type: 'refus', message: expect.stringContaining('spec') });
  });

  it('spec en cours de rédaction', () => {
    const enCours = ticket({ colonne: 'conception', spec: '# Spec', runEnCours: 'spec' });
    expect(resultatDepot(enCours, 'dev').type).toBe('refus');
  });

  it('ticket bloqué', () => {
    const bloque = ticket({
      colonne: 'conception',
      spec: '# Spec',
      blocage: { motif: 'Quota Claude atteint', cause: 'quota', le: MAINTENANT, repriseEstimee: null },
    });
    expect(resultatDepot(bloque, 'dev')).toMatchObject({ type: 'refus', message: expect.stringContaining('bloqué') });
  });
});

describe('dépôts d’un bug', () => {
  const bug = (partiel: Partial<Ticket> = {}) => ticket({ nature: 'bug', description: 'Le bouton reste grisé.', ...partiel });

  it('du backlog vers En dev : lance la correction', () => {
    expect(resultatDepot(bug(), 'dev')).toEqual({ type: 'action', action: 'LANCER_CORRECTION' });
  });

  it('du backlog vers En conception : refusé, un bug n’a pas de spec', () => {
    expect(resultatDepot(bug(), 'conception')).toMatchObject({ type: 'refus', message: expect.stringContaining('conception') });
  });

  it('du backlog vers En test : refusé', () => {
    expect(resultatDepot(bug(), 'test').type).toBe('refus');
  });

  it('sans description : refusé avec le motif de la machine à états', () => {
    expect(resultatDepot(bug({ description: '' }), 'dev')).toMatchObject({ type: 'refus', message: expect.stringContaining('reproduction') });
  });

  it('de En test vers Déploiement en prod : même décision qu’une fonctionnalité', () => {
    expect(resultatDepot(bug({ colonne: 'test' }), 'deploiement')).toEqual({ type: 'action', action: 'DEPLOYER_PROD' });
  });
});
