import { describe, expect, it } from 'vitest';
import { actionsDisponibles, estModifiable, estSupprimable, transition } from '../../src/domaine/machine-etats';
import { indexColonne, nomBranche } from '../../src/domaine/colonnes';
import { ACTEURS, COLONNES, TYPES_EVENEMENT, type Acteur, type Colonne, type TypeEvenement } from '../../src/domaine/types';
import { CTX, EVENEMENTS, MAINTENANT, SCENARIOS, SCENARIOS_ENREGISTRES, TOUT_VERT, URL_MAQUETTE, ticket, ticketFavorable } from './fixtures';

/**
 * Table de vérité écrite à la main, indépendante du code : pour chaque événement,
 * qui peut le déclencher, depuis quelles colonnes, et vers quelle colonne il mène.
 */
const AUTORISE: Record<TypeEvenement, { acteur: Acteur; depuis: Colonne[]; vers: 'meme' | Colonne; exigeBlocage?: boolean }> = {
  LANCER_CONCEPTION: { acteur: 'utilisatrice', depuis: ['backlog'], vers: 'conception' },
  SPEC_PRETE: { acteur: 'systeme', depuis: ['conception'], vers: 'meme' },
  LANCER_DESIGN: { acteur: 'utilisatrice', depuis: ['conception'], vers: 'meme' },
  DESIGN_PRET: { acteur: 'systeme', depuis: ['conception'], vers: 'meme' },
  LANCER_DEV: { acteur: 'utilisatrice', depuis: ['conception'], vers: 'dev' },
  // Bug seulement (la matrice le joue sur un bug, voir ticketFavorable) : seul passage qui saute une colonne.
  LANCER_CORRECTION: { acteur: 'utilisatrice', depuis: ['backlog'], vers: 'dev' },
  ITERATION_TERMINEE: { acteur: 'systeme', depuis: ['dev'], vers: 'meme' },
  DEV_TERMINE: { acteur: 'systeme', depuis: ['dev'], vers: 'meme' },
  PREPROD_DEPLOYEE: { acteur: 'systeme', depuis: ['dev'], vers: 'test' },
  DEPLOYER_PROD: { acteur: 'utilisatrice', depuis: ['test'], vers: 'deploiement' },
  ETAPE_DEPLOIEMENT: { acteur: 'systeme', depuis: ['deploiement'], vers: 'meme' },
  DEPLOIEMENT_TERMINE: { acteur: 'systeme', depuis: ['deploiement'], vers: 'done' },
  ECHEC: { acteur: 'systeme', depuis: ['conception', 'dev', 'deploiement'], vers: 'meme' },
  QUOTA_ATTEINT: { acteur: 'systeme', depuis: ['conception', 'dev'], vers: 'meme' },
  RELANCER: { acteur: 'utilisatrice', depuis: ['conception', 'dev', 'deploiement'], vers: 'meme', exigeBlocage: true },
  RETRAVAILLER_SPEC: { acteur: 'utilisatrice', depuis: ['conception'], vers: 'meme' },
  RETRAVAILLER_DESIGN: { acteur: 'utilisatrice', depuis: ['conception'], vers: 'meme' },
};

describe('matrice complète des transitions', () => {
  for (const type of TYPES_EVENEMENT) {
    for (const colonne of COLONNES) {
      for (const acteur of ACTEURS) {
        for (const bloque of [false, true]) {
          const regle = AUTORISE[type];
          const attendu =
            regle.acteur === acteur && regle.depuis.includes(colonne) && (regle.exigeBlocage ? bloque : !bloque);
          const titre = `${type} par ${acteur} depuis ${colonne}${bloque ? ' bloqué' : ''} : ${attendu ? 'autorisé' : 'refusé'}`;

          it(titre, () => {
            const avant = ticketFavorable(colonne, type, bloque);
            const resultat = transition(avant, EVENEMENTS[type], acteur, CTX);
            expect(resultat.ok).toBe(attendu);
            if (resultat.ok) {
              const vers = regle.vers === 'meme' ? colonne : regle.vers;
              expect(resultat.ticket.colonne).toBe(vers);
              expect(resultat.journal.length).toBeGreaterThan(0);
            } else {
              expect(resultat.message.length).toBeGreaterThan(0);
            }
          });
        }
      }
    }
  }
});

describe('invariants', () => {
  it('aucune transition autorisée ne saute de colonne ni ne recule, sauf la correction directe d’un bug', () => {
    for (const type of TYPES_EVENEMENT) {
      for (const colonne of COLONNES) {
        for (const acteur of ACTEURS) {
          for (const bloque of [false, true]) {
            const avant = ticketFavorable(colonne, type, bloque);
            const r = transition(avant, EVENEMENTS[type], acteur, CTX);
            if (r.ok) {
              const ecart = indexColonne(r.ticket.colonne) - indexColonne(colonne);
              const sautPermis = type === 'LANCER_CORRECTION' && avant.nature === 'bug' && colonne === 'backlog';
              expect(sautPermis ? [2] : [0, 1]).toContain(ecart);
            }
          }
        }
      }
    }
  });

  it('ne modifie jamais le ticket reçu', () => {
    const avant = ticket({ colonne: 'backlog' });
    const copie = structuredClone(avant);
    transition(avant, EVENEMENTS.LANCER_CONCEPTION, 'utilisatrice', CTX);
    expect(avant).toEqual(copie);
  });

  it('Done est final', () => {
    for (const type of TYPES_EVENEMENT) {
      for (const acteur of ACTEURS) {
        const r = transition(ticket({ colonne: 'done' }), EVENEMENTS[type], acteur, CTX);
        expect(r.ok).toBe(false);
      }
    }
  });

  it('refuse avec le bon code', () => {
    const acteurFaux = transition(ticket(), EVENEMENTS.LANCER_CONCEPTION, 'systeme', CTX);
    expect(acteurFaux).toMatchObject({ ok: false, code: 'ACTEUR_INTERDIT' });

    const mauvaiseColonne = transition(ticket({ colonne: 'dev' }), EVENEMENTS.LANCER_CONCEPTION, 'utilisatrice', CTX);
    expect(mauvaiseColonne).toMatchObject({ ok: false, code: 'TRANSITION_INTERDITE' });

    const bloque = transition(ticketFavorable('conception', 'LANCER_DEV', true), EVENEMENTS.LANCER_DEV, 'utilisatrice', CTX);
    expect(bloque).toMatchObject({ ok: false, code: 'TICKET_BLOQUE' });

    const termine = transition(ticket({ colonne: 'done' }), EVENEMENTS.RELANCER, 'utilisatrice', CTX);
    expect(termine).toMatchObject({ ok: false, code: 'TICKET_TERMINE' });
  });
});

describe('Backlog vers En conception', () => {
  it('démarre la rédaction de la spec et le journalise', () => {
    const r = transition(ticket(), EVENEMENTS.LANCER_CONCEPTION, 'utilisatrice', CTX);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ticket.runEnCours).toBe('spec');
    expect(r.effets).toEqual([{ type: 'DEMARRER_RUN', run: 'spec' }]);
    expect(r.ticket.modifieLe).toBe(MAINTENANT);
  });

  it('fixe la branche dès la conception, pour y commiter la maquette', () => {
    const r = transition(ticket(), EVENEMENTS.LANCER_CONCEPTION, 'utilisatrice', CTX);
    expect(r.ok && r.ticket.branche).toBe('claude/12-fiche-personnage');
  });
});

describe('spec prête', () => {
  const enConception = ticket({ colonne: 'conception', runEnCours: 'spec' });

  it('rattache la spec, incrémente sa version et enchaîne sur le design', () => {
    const r = transition(enConception, { type: 'SPEC_PRETE', spec: '# Ma spec' }, 'systeme', CTX);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ticket.spec).toBe('# Ma spec');
    expect(r.ticket.specVersion).toBe(1);
    expect(r.ticket.runEnCours).toBe('design');
    expect(r.ticket.colonne).toBe('conception');
    expect(r.effets).toEqual([{ type: 'DEMARRER_RUN', run: 'design' }]);
  });

  it('refuse une spec vide', () => {
    const r = transition(enConception, { type: 'SPEC_PRETE', spec: '   ' }, 'systeme', CTX);
    expect(r).toMatchObject({ ok: false, code: 'CONDITION_NON_REMPLIE' });
  });

  it('refuse sans rédaction en cours', () => {
    const r = transition(ticket({ colonne: 'conception' }), { type: 'SPEC_PRETE', spec: '# x' }, 'systeme', CTX);
    expect(r).toMatchObject({ ok: false, code: 'CONDITION_NON_REMPLIE' });
  });
});

describe('design prêt', () => {
  const enDesign = ticket({ colonne: 'conception', spec: '# v1', specVersion: 1, runEnCours: 'design', branche: 'claude/12-fiche-personnage' });

  it('rattache le résumé et la maquette, puis rend la main', () => {
    const r = transition(enDesign, { type: 'DESIGN_PRET', resume: '# Design', urlMaquette: URL_MAQUETTE }, 'systeme', CTX);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ticket.design).toBe('# Design');
    expect(r.ticket.urlMaquette).toBe(URL_MAQUETTE);
    expect(r.ticket.designVersion).toBe(1);
    expect(r.ticket.runEnCours).toBe(null);
    expect(r.ticket.colonne).toBe('conception');
    expect(r.effets).toEqual([]);
    expect(r.journal[0]?.type).toBe('design');
  });

  it('refuse un résumé vide', () => {
    const r = transition(enDesign, { type: 'DESIGN_PRET', resume: ' ', urlMaquette: URL_MAQUETTE }, 'systeme', CTX);
    expect(r).toMatchObject({ ok: false, code: 'CONDITION_NON_REMPLIE' });
  });

  it('refuse une maquette sans lien web', () => {
    for (const urlMaquette of ['', 'maquettes/ticket-12.html', 'javascript:alert(1)']) {
      const r = transition(enDesign, { type: 'DESIGN_PRET', resume: '# Design', urlMaquette }, 'systeme', CTX);
      expect(r).toMatchObject({ ok: false, code: 'CONDITION_NON_REMPLIE' });
    }
  });

  it('refuse sans design en cours', () => {
    const r = transition({ ...enDesign, runEnCours: 'spec' }, EVENEMENTS.DESIGN_PRET, 'systeme', CTX);
    expect(r).toMatchObject({ ok: false, code: 'CONDITION_NON_REMPLIE' });
  });
});

describe('lancer le design à la main', () => {
  const specSeule = ticket({ colonne: 'conception', spec: '# v1', specVersion: 1 });

  it('lance le design d’un ticket qui a une spec sans design', () => {
    const r = transition(specSeule, EVENEMENTS.LANCER_DESIGN, 'utilisatrice', CTX);
    expect(r.ok && r.ticket.runEnCours).toBe('design');
    expect(r.ok && r.ticket.branche).toBe('claude/12-fiche-personnage');
    expect(r.ok && r.effets).toEqual([{ type: 'DEMARRER_RUN', run: 'design' }]);
  });

  it('refuse sans spec', () => {
    const r = transition({ ...specSeule, spec: null }, EVENEMENTS.LANCER_DESIGN, 'utilisatrice', CTX);
    expect(r).toMatchObject({ ok: false, code: 'CONDITION_NON_REMPLIE' });
  });

  it('refuse si le design existe déjà', () => {
    const r = transition({ ...specSeule, design: '# D', urlMaquette: URL_MAQUETTE }, EVENEMENTS.LANCER_DESIGN, 'utilisatrice', CTX);
    expect(r).toMatchObject({ ok: false, code: 'CONDITION_NON_REMPLIE' });
  });

  it('refuse pendant un run', () => {
    const r = transition({ ...specSeule, runEnCours: 'design' }, EVENEMENTS.LANCER_DESIGN, 'utilisatrice', CTX);
    expect(r).toMatchObject({ ok: false, code: 'CONDITION_NON_REMPLIE' });
  });
});

describe('retravailler la spec ou le design après un commentaire', () => {
  const pret = ticket({ colonne: 'conception', spec: '# v1', specVersion: 1, design: '# D', urlMaquette: URL_MAQUETTE, designVersion: 1, branche: 'claude/12-fiche-personnage' });

  it('relance la rédaction de la spec, sans changer de colonne', () => {
    const r = transition(pret, EVENEMENTS.RETRAVAILLER_SPEC, 'utilisatrice', CTX);
    expect(r.ok && r.ticket).toMatchObject({ colonne: 'conception', runEnCours: 'spec', spec: '# v1', specVersion: 1 });
    expect(r.ok && r.effets).toEqual([{ type: 'DEMARRER_RUN', run: 'spec' }]);
    expect(r.ok && r.journal).toEqual([{ type: 'action', detail: 'Claude retravaille la spec avec vos commentaires.' }]);
  });

  it('la nouvelle spec relance ensuite le design', () => {
    const r = transition(pret, EVENEMENTS.RETRAVAILLER_SPEC, 'utilisatrice', CTX);
    if (!r.ok) throw new Error(r.message);
    const suite = transition(r.ticket, { type: 'SPEC_PRETE', spec: '# v2' }, 'systeme', CTX);
    expect(suite.ok && suite.ticket).toMatchObject({ spec: '# v2', specVersion: 2, runEnCours: 'design' });
  });

  it('relance le design même s’il existe déjà', () => {
    const r = transition(pret, EVENEMENTS.RETRAVAILLER_DESIGN, 'utilisatrice', CTX);
    expect(r.ok && r.ticket).toMatchObject({ colonne: 'conception', runEnCours: 'design', design: '# D' });
    expect(r.ok && r.effets).toEqual([{ type: 'DEMARRER_RUN', run: 'design' }]);
    expect(r.ok && r.journal).toEqual([{ type: 'action', detail: 'Claude retravaille le design avec vos commentaires.' }]);
  });

  it('refuse pendant un run', () => {
    for (const type of ['RETRAVAILLER_SPEC', 'RETRAVAILLER_DESIGN'] as const) {
      expect(transition({ ...pret, runEnCours: 'design' }, EVENEMENTS[type], 'utilisatrice', CTX)).toMatchObject({ ok: false, code: 'CONDITION_NON_REMPLIE' });
    }
  });

  it('refuse le design sans spec', () => {
    expect(transition({ ...pret, spec: null }, EVENEMENTS.RETRAVAILLER_DESIGN, 'utilisatrice', CTX)).toMatchObject({ ok: false, code: 'CONDITION_NON_REMPLIE' });
  });

  it('refuse sur un ticket bloqué : seul Relancer le fait repartir', () => {
    const bloque = { ...pret, blocage: { motif: 'Quota Claude atteint', cause: 'quota', le: MAINTENANT, repriseEstimee: null } } as const;
    expect(transition(bloque, EVENEMENTS.RETRAVAILLER_SPEC, 'utilisatrice', CTX)).toMatchObject({ ok: false, code: 'TICKET_BLOQUE' });
  });

  it('ne propose pas de bouton sur la carte', () => {
    expect(actionsDisponibles(pret)).toEqual(['LANCER_DEV']);
  });
});

describe('En conception vers En dev', () => {
  const pret = { colonne: 'conception', spec: '# v1', specVersion: 1, design: '# D', urlMaquette: URL_MAQUETTE, designVersion: 1 } as const;

  it('refuse sans spec rattachée', () => {
    const r = transition(ticket({ ...pret, spec: null }), EVENEMENTS.LANCER_DEV, 'utilisatrice', CTX);
    expect(r).toMatchObject({ ok: false, code: 'CONDITION_NON_REMPLIE' });
  });

  it('accepte sans design : le design est facultatif', () => {
    const r = transition(ticket({ ...pret, design: null, urlMaquette: null, designVersion: 0 }), EVENEMENTS.LANCER_DEV, 'utilisatrice', CTX);
    expect(r.ok && r.ticket.colonne).toBe('dev');
    expect(r.ok && r.effets).toEqual([{ type: 'DEMARRER_RUN', run: 'dev' }]);
  });

  it('refuse pendant la rédaction de la spec', () => {
    const r = transition(ticket({ ...pret, runEnCours: 'spec' }), EVENEMENTS.LANCER_DEV, 'utilisatrice', CTX);
    expect(r).toMatchObject({ ok: false, code: 'CONDITION_NON_REMPLIE' });
  });

  it('refuse pendant le design', () => {
    const r = transition(ticket({ ...pret, runEnCours: 'design' }), EVENEMENTS.LANCER_DEV, 'utilisatrice', CTX);
    expect(r).toMatchObject({ ok: false, code: 'CONDITION_NON_REMPLIE' });
  });

  it('garde la branche fixée en conception', () => {
    const r = transition(ticket({ ...pret, branche: 'claude/12-ancien-titre' }), EVENEMENTS.LANCER_DEV, 'utilisatrice', CTX);
    expect(r.ok && r.ticket.branche).toBe('claude/12-ancien-titre');
  });

  it('crée une branche au nom prévisible et lance la boucle de dev', () => {
    const r = transition(ticket(pret), EVENEMENTS.LANCER_DEV, 'utilisatrice', CTX);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ticket.branche).toBe('claude/12-fiche-personnage');
    expect(r.ticket.iteration).toBe(0);
    expect(r.ticket.runEnCours).toBe('dev');
    expect(r.effets).toEqual([{ type: 'DEMARRER_RUN', run: 'dev' }]);
  });
});

describe('boucle de dev', () => {
  const enDev = ticket({ colonne: 'dev', runEnCours: 'dev', spec: '# v1', iteration: 2, iterationMax: 5 });

  it('enregistre une itération et ses contrôles', () => {
    const controles = { unitaires: 'vert', non_regression: 'rouge', exploratoire: 'en_attente' } as const;
    const r = transition(enDev, { type: 'ITERATION_TERMINEE', iteration: 3, controles }, 'systeme', CTX);
    expect(r.ok && r.ticket.iteration).toBe(3);
    expect(r.ok && r.ticket.controles).toEqual(controles);
    expect(r.ok && r.ticket.blocage).toBe(null);
    expect(r.ok && r.journal[0]?.type).toBe('iteration');
  });

  it('refuse une itération qui ne progresse pas', () => {
    const r = transition(enDev, { type: 'ITERATION_TERMINEE', iteration: 2, controles: TOUT_VERT }, 'systeme', CTX);
    expect(r).toMatchObject({ ok: false, code: 'CONDITION_NON_REMPLIE' });
  });

  it('bloque le ticket au maximum d’itérations si des contrôles échouent', () => {
    const controles = { unitaires: 'rouge', non_regression: 'rouge', exploratoire: 'vert' } as const;
    const r = transition({ ...enDev, iteration: 4 }, { type: 'ITERATION_TERMINEE', iteration: 5, controles }, 'systeme', CTX);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ticket.colonne).toBe('dev');
    expect(r.ticket.runEnCours).toBe(null);
    expect(r.ticket.blocage).toMatchObject({ cause: 'iterations', motif: '5 itérations atteintes, 2 contrôles échouent.' });
  });

  it('ne bloque pas au maximum si tout est vert', () => {
    const r = transition({ ...enDev, iteration: 4 }, { type: 'ITERATION_TERMINEE', iteration: 5, controles: TOUT_VERT }, 'systeme', CTX);
    expect(r.ok && r.ticket.blocage).toBe(null);
  });

  it('bloque au delà du maximum', () => {
    const r = transition({ ...enDev, iteration: 5 }, { type: 'ITERATION_TERMINEE', iteration: 6, controles: TOUT_VERT }, 'systeme', CTX);
    expect(r.ok && r.ticket.blocage?.cause).toBe('iterations');
  });
});

describe('fin du dev : déploiement en préprod', () => {
  const enDev = ticket({ colonne: 'dev', runEnCours: 'dev', spec: '# v1', iteration: 3 });
  const fin = { type: 'DEV_TERMINE', controles: TOUT_VERT, scenarios: SCENARIOS } as const;

  it('garde les scénarios, reste en dev et lance la préprod', () => {
    const r = transition(enDev, fin, 'systeme', CTX);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ticket.colonne).toBe('dev');
    expect(r.ticket.runEnCours).toBe('preprod');
    expect(r.ticket.scenarios).toHaveLength(2);
    expect(r.ticket.scenarios.every((s) => !s.fait)).toBe(true);
    expect(r.ticket.urlPreprod).toBe(null);
    expect(r.effets).toEqual([{ type: 'DEMARRER_RUN', run: 'preprod' }]);
  });

  it('bloque sans lancer de déploiement quand un autre ticket du projet occupe la préprod', () => {
    const r = transition(enDev, fin, 'systeme', { ...CTX, preprodOccupeePar: 7 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ticket.colonne).toBe('dev');
    expect(r.ticket.runEnCours).toBe(null);
    expect(r.ticket.blocage).toMatchObject({ motif: 'Préprod occupée par le ticket 7.', cause: 'echec' });
    expect(r.ticket.scenarios).toHaveLength(2);
    expect(r.effets).toEqual([]);
  });
});

describe('En dev vers En test', () => {
  const enPreprod = ticket({ colonne: 'dev', runEnCours: 'preprod', spec: '# v1', iteration: 3, controles: TOUT_VERT, scenarios: SCENARIOS_ENREGISTRES });
  const fin = { type: 'DEV_TERMINE', controles: TOUT_VERT, scenarios: SCENARIOS } as const;
  const enDev = ticket({ colonne: 'dev', runEnCours: 'dev', spec: '# v1', iteration: 3 });

  it('passe en test quand la préprod est confirmée en ligne', () => {
    const r = transition(enPreprod, EVENEMENTS.PREPROD_DEPLOYEE, 'systeme', CTX);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ticket.colonne).toBe('test');
    expect(r.ticket.urlPreprod).toBe('https://preprod.exemple.fr');
    expect(r.ticket.runEnCours).toBe(null);
    expect(r.journal.map((j) => j.detail).join(' ')).toContain('a1b2c3d');
  });

  it('refuse une préprod sans lien web ou sans version', () => {
    for (const evenement of [
      { type: 'PREPROD_DEPLOYEE', urlPreprod: '', version: 'a1b2c3d' },
      { type: 'PREPROD_DEPLOYEE', urlPreprod: 'preprod.exemple.fr', version: 'a1b2c3d' },
      { type: 'PREPROD_DEPLOYEE', urlPreprod: 'https://preprod.exemple.fr', version: ' ' },
    ] as const) {
      expect(transition(enPreprod, evenement, 'systeme', CTX)).toMatchObject({ ok: false, code: 'CONDITION_NON_REMPLIE' });
    }
  });

  it('refuse une préprod annoncée pendant la boucle de dev', () => {
    expect(transition(enDev, EVENEMENTS.PREPROD_DEPLOYEE, 'systeme', CTX)).toMatchObject({ ok: false, code: 'CONDITION_NON_REMPLIE' });
  });

  it('un échec de préprod bloque en dev et garde les scénarios', () => {
    const r = transition(enPreprod, { type: 'ECHEC', motif: 'SSH refusé.' }, 'systeme', CTX);
    expect(r.ok && r.ticket.colonne).toBe('dev');
    expect(r.ok && r.ticket.blocage?.motif).toBe('SSH refusé.');
    expect(r.ok && r.ticket.scenarios).toHaveLength(2);
  });

  it('un conflit avec la branche principale en préprod bloque avec la cause conflit', () => {
    const r = transition(enPreprod, { type: 'ECHEC', motif: 'Conflit avec main.', conflit: true }, 'systeme', CTX);
    expect(r.ok && r.ticket.colonne).toBe('dev');
    expect(r.ok && r.ticket.blocage).toMatchObject({ motif: 'Conflit avec main.', cause: 'conflit' });
  });

  it('le quota Claude ne concerne pas la préprod', () => {
    expect(transition(enPreprod, EVENEMENTS.QUOTA_ATTEINT, 'systeme', CTX)).toMatchObject({ ok: false, code: 'CONDITION_NON_REMPLIE' });
  });

  it('refuse si un contrôle n’est pas vert', () => {
    const controles = { ...TOUT_VERT, exploratoire: 'rouge' } as const;
    expect(transition(enDev, { ...fin, controles }, 'systeme', CTX)).toMatchObject({ ok: false, code: 'CONDITION_NON_REMPLIE' });
  });

  it('refuse sans scénarios', () => {
    expect(transition(enDev, { ...fin, scenarios: [] }, 'systeme', CTX)).toMatchObject({ ok: false, code: 'CONDITION_NON_REMPLIE' });
  });

  it('refuse avec un seul scénario : il faut au moins le nominal et une erreur', () => {
    expect(transition(enDev, { ...fin, scenarios: [SCENARIOS[0]!] }, 'systeme', CTX)).toMatchObject({ ok: false, code: 'CONDITION_NON_REMPLIE' });
  });
});

describe('En test vers Déploiement en prod', () => {
  const enTest = ticket({ colonne: 'test', spec: '# v1', urlPreprod: 'https://preprod.exemple.fr' });

  it('exige une confirmation explicite', () => {
    const r = transition(enTest, { type: 'DEPLOYER_PROD', confirmation: false }, 'utilisatrice', CTX);
    expect(r).toMatchObject({ ok: false, code: 'CONDITION_NON_REMPLIE' });
  });

  it('lance le déploiement après confirmation', () => {
    const r = transition(enTest, EVENEMENTS.DEPLOYER_PROD, 'utilisatrice', CTX);
    expect(r.ok && r.ticket.colonne).toBe('deploiement');
    expect(r.ok && r.ticket.runEnCours).toBe('deploiement');
    expect(r.ok && r.effets).toEqual([{ type: 'DEMARRER_RUN', run: 'deploiement' }]);
  });

  it('le système ne peut jamais déployer seul', () => {
    const r = transition(enTest, EVENEMENTS.DEPLOYER_PROD, 'systeme', CTX);
    expect(r).toMatchObject({ ok: false, code: 'ACTEUR_INTERDIT' });
  });
});

describe('Déploiement en prod vers Done', () => {
  const enDeploiement = ticket({ colonne: 'deploiement', runEnCours: 'deploiement' });

  it('suit les étapes du déploiement', () => {
    const r = transition(enDeploiement, EVENEMENTS.ETAPE_DEPLOIEMENT, 'systeme', CTX);
    expect(r.ok && r.ticket.etapesDeploiement.fusion).toBe('vert');
  });

  it('enregistre la date et la version', () => {
    const r = transition(enDeploiement, EVENEMENTS.DEPLOIEMENT_TERMINE, 'systeme', CTX);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ticket.colonne).toBe('done');
    expect(r.ticket.versionDeployee).toBe('v1.4.0');
    expect(r.ticket.deployeLe).toBe(MAINTENANT);
    expect(r.ticket.runEnCours).toBe(null);
  });

  it('refuse sans version', () => {
    expect(transition(enDeploiement, { type: 'DEPLOIEMENT_TERMINE', version: ' ' }, 'systeme', CTX)).toMatchObject({ ok: false });
  });

  it('un conflit en prod reste un échec : le ticket ne revient jamais en dev', () => {
    const r = transition(enDeploiement, { type: 'ECHEC', motif: 'Conflit avec main.', conflit: true }, 'systeme', CTX);
    expect(r.ok && r.ticket.colonne).toBe('deploiement');
    expect(r.ok && r.ticket.blocage?.cause).toBe('echec');
  });

  it('un échec de déploiement bloque sans jamais passer en Done', () => {
    const r = transition(enDeploiement, { type: 'ECHEC', motif: 'Le serveur ne répond pas.' }, 'systeme', CTX);
    expect(r.ok && r.ticket.colonne).toBe('deploiement');
    expect(r.ok && r.ticket.blocage?.motif).toBe('Le serveur ne répond pas.');
  });
});

describe('blocages et relance', () => {
  it('un échec de spec garde la description d’origine', () => {
    const avant = ticket({ colonne: 'conception', runEnCours: 'spec', description: 'Idée originale' });
    const r = transition(avant, { type: 'ECHEC', motif: 'Rédaction impossible.' }, 'systeme', CTX);
    expect(r.ok && r.ticket.description).toBe('Idée originale');
    expect(r.ok && r.ticket.blocage).toMatchObject({ cause: 'echec', le: MAINTENANT });
  });

  it('un échec sans run en cours est refusé', () => {
    const r = transition(ticket({ colonne: 'dev', runEnCours: null }), EVENEMENTS.ECHEC, 'systeme', CTX);
    expect(r).toMatchObject({ ok: false, code: 'CONDITION_NON_REMPLIE' });
  });

  it('le quota atteint bloque avec le motif imposé et l’heure de reprise', () => {
    const r = transition(ticket({ colonne: 'dev', runEnCours: 'dev' }), EVENEMENTS.QUOTA_ATTEINT, 'systeme', CTX);
    expect(r.ok && r.ticket.blocage).toEqual({
      motif: 'Quota Claude atteint',
      cause: 'quota',
      le: MAINTENANT,
      repriseEstimee: '2026-11-17T15:00:00.000Z',
    });
    expect(r.ok && r.ticket.runEnCours).toBe(null);
  });

  it('un ticket bloqué ne repart jamais seul : le système ne peut pas relancer', () => {
    const bloque = ticketFavorable('dev', 'RELANCER', true);
    expect(transition(bloque, EVENEMENTS.RELANCER, 'systeme', CTX)).toMatchObject({ ok: false, code: 'ACTEUR_INTERDIT' });
    for (const type of TYPES_EVENEMENT.filter((t) => t !== 'RELANCER')) {
      expect(transition(bloque, EVENEMENTS[type], 'systeme', CTX).ok).toBe(false);
    }
  });

  describe('relance après un échec de préprod', () => {
    const devPret = ticket({
      colonne: 'dev',
      spec: '# v1',
      iteration: 3,
      controles: TOUT_VERT,
      scenarios: SCENARIOS_ENREGISTRES,
      blocage: { motif: 'SSH refusé.', cause: 'echec', le: MAINTENANT, repriseEstimee: null },
    });

    it('ne relance que la préprod, sans refaire le dev', () => {
      const r = transition(devPret, EVENEMENTS.RELANCER, 'utilisatrice', CTX);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.ticket.runEnCours).toBe('preprod');
      expect(r.ticket.iteration).toBe(3);
      expect(r.ticket.scenarios).toHaveLength(2);
      expect(r.effets).toEqual([{ type: 'DEMARRER_RUN', run: 'preprod' }]);
    });

    it('refuse tant que la préprod est occupée par un autre ticket', () => {
      const r = transition(devPret, EVENEMENTS.RELANCER, 'utilisatrice', { ...CTX, preprodOccupeePar: 7 });
      expect(r).toMatchObject({ ok: false, code: 'CONDITION_NON_REMPLIE', message: 'Préprod occupée par le ticket 7.' });
    });

    it('relance la boucle de dev quand la branche est en conflit avec la branche principale', () => {
      const enConflit = { ...devPret, blocage: { motif: 'Conflit avec main.', cause: 'conflit' as const, le: MAINTENANT, repriseEstimee: null } };
      const r = transition(enConflit, EVENEMENTS.RELANCER, 'utilisatrice', CTX);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.ticket.runEnCours).toBe('dev');
      expect(r.ticket.iteration).toBe(0);
      expect(r.effets).toEqual([{ type: 'DEMARRER_RUN', run: 'dev' }]);
    });

    it('relance la boucle de dev si les contrôles ne sont pas tous verts', () => {
      const r = transition({ ...devPret, controles: { ...TOUT_VERT, exploratoire: 'rouge' } }, EVENEMENTS.RELANCER, 'utilisatrice', CTX);
      expect(r.ok && r.ticket.runEnCours).toBe('dev');
    });
  });

  it('la relance en dev repart d’une boucle neuve', () => {
    const bloque = ticket({
      colonne: 'dev',
      spec: '# v1',
      iteration: 5,
      controles: { unitaires: 'rouge', non_regression: 'rouge', exploratoire: 'vert' },
      blocage: { motif: '5 itérations atteintes', cause: 'iterations', le: MAINTENANT, repriseEstimee: null },
    });
    const r = transition(bloque, EVENEMENTS.RELANCER, 'utilisatrice', CTX);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ticket.blocage).toBe(null);
    expect(r.ticket.iteration).toBe(0);
    expect(r.ticket.controles.unitaires).toBe('en_attente');
    expect(r.ticket.runEnCours).toBe('dev');
    expect(r.effets).toEqual([{ type: 'DEMARRER_RUN', run: 'dev' }]);
    expect(r.journal.some((j) => j.type === 'deblocage')).toBe(true);
  });

  it('la relance en conception relance la rédaction de la spec quand elle manque', () => {
    const bloque = { ...ticketFavorable('conception', 'RELANCER', true), spec: null, design: null, urlMaquette: null };
    const r = transition(bloque, EVENEMENTS.RELANCER, 'utilisatrice', CTX);
    expect(r.ok && r.effets).toEqual([{ type: 'DEMARRER_RUN', run: 'spec' }]);
    expect(r.ok && r.ticket.runEnCours).toBe('spec');
  });

  it('la relance en conception relance seulement le design quand la spec existe', () => {
    const bloque = { ...ticketFavorable('conception', 'RELANCER', true), design: null, urlMaquette: null };
    const r = transition(bloque, EVENEMENTS.RELANCER, 'utilisatrice', CTX);
    expect(r.ok && r.effets).toEqual([{ type: 'DEMARRER_RUN', run: 'design' }]);
    expect(r.ok && r.ticket.spec).toBe('# Spec');
  });

  it('la relance en déploiement relance le pipeline', () => {
    const r = transition(ticketFavorable('deploiement', 'RELANCER', true), EVENEMENTS.RELANCER, 'utilisatrice', CTX);
    expect(r.ok && r.effets).toEqual([{ type: 'DEMARRER_RUN', run: 'deploiement' }]);
    expect(r.ok && r.ticket.etapesDeploiement.fusion).toBe('en_attente');
  });
});

describe('actions disponibles pour l’interface', () => {
  it('propose Lancer la conception en backlog', () => {
    expect(actionsDisponibles(ticket())).toEqual(['LANCER_CONCEPTION']);
  });

  it('ne propose pas Lancer le dev sans spec', () => {
    expect(actionsDisponibles(ticket({ colonne: 'conception', runEnCours: 'spec' }))).toEqual([]);
  });

  it('ne propose rien pendant le design', () => {
    expect(actionsDisponibles(ticket({ colonne: 'conception', spec: '# v1', runEnCours: 'design' }))).toEqual([]);
  });

  it('propose Lancer le design et Lancer le dev quand seule la spec existe', () => {
    expect(actionsDisponibles(ticket({ colonne: 'conception', spec: '# v1' }))).toEqual(['LANCER_DESIGN', 'LANCER_DEV']);
  });

  it('propose Lancer le dev quand spec et design sont prêts', () => {
    expect(actionsDisponibles(ticket({ colonne: 'conception', spec: '# v1', design: '# D', urlMaquette: URL_MAQUETTE }))).toEqual(['LANCER_DEV']);
  });

  it('propose Déployer en prod en test', () => {
    expect(actionsDisponibles(ticket({ colonne: 'test' }))).toEqual(['DEPLOYER_PROD']);
  });

  it('propose seulement Relancer sur un ticket bloqué', () => {
    expect(actionsDisponibles(ticketFavorable('dev', 'RELANCER', true))).toEqual(['RELANCER']);
  });

  it('ne propose rien en Done ni pendant un run', () => {
    expect(actionsDisponibles(ticket({ colonne: 'done' }))).toEqual([]);
    expect(actionsDisponibles(ticket({ colonne: 'dev', runEnCours: 'dev' }))).toEqual([]);
  });
});

describe('nom de branche', () => {
  it('retire accents et ponctuation', () => {
    expect(nomBranche(7, 'Export des bénévoles en CSV !')).toBe('claude/7-export-des-benevoles-en-csv');
  });

  it('tronque les titres longs', () => {
    expect(nomBranche(1, 'a'.repeat(80)).length).toBeLessThanOrEqual('claude/1-'.length + 40);
  });
});

describe('modification et suppression', () => {
  it.each(COLONNES)('supprime un ticket sans run en cours en %s', (colonne) => {
    expect(estSupprimable(ticket({ colonne }))).toBe(true);
  });

  it('supprime un ticket bloqué', () => {
    const blocage = { motif: 'Quota Claude atteint', cause: 'quota', le: MAINTENANT, repriseEstimee: null } as const;
    expect(estSupprimable(ticket({ colonne: 'dev', blocage }))).toBe(true);
  });

  it.each(['spec', 'design', 'dev', 'preprod', 'deploiement'] as const)('refuse la suppression pendant un run %s', (runEnCours) => {
    expect(estSupprimable(ticket({ colonne: 'dev', runEnCours }))).toBe(false);
  });

  it('ne modifie que le backlog', () => {
    expect(COLONNES.filter((colonne) => estModifiable(ticket({ colonne })))).toEqual(['backlog']);
  });
});

describe('bugs : correction directe sans spec', () => {
  const bug = (partiel: Parameters<typeof ticket>[0] = {}) =>
    ticket({ nature: 'bug', titre: 'Jet de dés affiché deux fois', description: 'Le résultat apparaît deux fois après un jet.', ...partiel });

  it('passe du backlog à En dev et lance la boucle de dev', () => {
    const r = transition(bug(), EVENEMENTS.LANCER_CORRECTION, 'utilisatrice', CTX);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ticket).toMatchObject({ colonne: 'dev', runEnCours: 'dev', iteration: 0, branche: 'claude/12-jet-de-des-affiche-deux-fois', spec: null });
    expect(r.effets).toEqual([{ type: 'DEMARRER_RUN', run: 'dev' }]);
    expect(r.journal.map((e) => e.detail)).toEqual([
      'Passage de Backlog à En dev, sans conception : c’est un bug.',
      'Vous avez lancé la correction sur la branche claude/12-jet-de-des-affiche-deux-fois. Claude écrit d’abord un test qui reproduit le bug.',
    ]);
  });

  it('demande une description, qui sert de reproduction', () => {
    const r = transition(bug({ description: '   ' }), EVENEMENTS.LANCER_CORRECTION, 'utilisatrice', CTX);
    expect(r).toMatchObject({ ok: false, code: 'CONDITION_NON_REMPLIE' });
  });

  it.each(['LANCER_CONCEPTION', 'LANCER_DESIGN', 'LANCER_DEV'] as const)('refuse %s pour un bug, dans toutes les colonnes', (type) => {
    for (const colonne of COLONNES) {
      const avant = { ...ticketFavorable(colonne, type, false), nature: 'bug' as const };
      expect(transition(avant, EVENEMENTS[type], 'utilisatrice', CTX).ok).toBe(false);
    }
  });

  it('refuse la correction directe pour une fonctionnalité', () => {
    const r = transition(ticket({ nature: 'fonctionnalite' }), EVENEMENTS.LANCER_CORRECTION, 'utilisatrice', CTX);
    expect(r).toMatchObject({ ok: false, code: 'TRANSITION_INTERDITE' });
  });

  it('refuse la correction lancée par le système', () => {
    expect(transition(bug(), EVENEMENTS.LANCER_CORRECTION, 'systeme', CTX)).toMatchObject({ ok: false, code: 'ACTEUR_INTERDIT' });
  });

  it('refuse la correction hors du backlog', () => {
    for (const colonne of COLONNES.filter((c) => c !== 'backlog')) {
      expect(transition(bug({ colonne }), EVENEMENTS.LANCER_CORRECTION, 'utilisatrice', CTX).ok).toBe(false);
    }
  });

  it('propose seulement la correction pour un bug du backlog, et jamais pour une fonctionnalité', () => {
    expect(actionsDisponibles(bug())).toEqual(['LANCER_CORRECTION']);
    expect(actionsDisponibles(ticket())).toEqual(['LANCER_CONCEPTION']);
  });

  it('suit ensuite le même chemin qu’une fonctionnalité, jusqu’à Done avec confirmation', () => {
    let t = bug();
    const etapes: [Parameters<typeof transition>[1], 'utilisatrice' | 'systeme'][] = [
      [EVENEMENTS.LANCER_CORRECTION, 'utilisatrice'],
      [{ type: 'ITERATION_TERMINEE', iteration: 1, controles: TOUT_VERT }, 'systeme'],
      [{ type: 'DEV_TERMINE', controles: TOUT_VERT, scenarios: SCENARIOS }, 'systeme'],
      [EVENEMENTS.PREPROD_DEPLOYEE, 'systeme'],
      [{ type: 'DEPLOYER_PROD', confirmation: false }, 'utilisatrice'],
      [EVENEMENTS.DEPLOYER_PROD, 'utilisatrice'],
      [EVENEMENTS.DEPLOIEMENT_TERMINE, 'systeme'],
    ];
    const colonnes: string[] = [];
    for (const [evenement, acteur] of etapes) {
      const r = transition(t, evenement, acteur, CTX);
      if (evenement.type === 'DEPLOYER_PROD' && !evenement.confirmation) {
        expect(r.ok).toBe(false);
        continue;
      }
      expect(r.ok).toBe(true);
      if (r.ok) t = r.ticket;
      colonnes.push(t.colonne);
    }
    expect(colonnes).toEqual(['dev', 'dev', 'dev', 'test', 'deploiement', 'done']);
  });

  it('se relance en dev après un blocage, sans repasser par la conception', () => {
    const bloque = bug({ colonne: 'dev', blocage: { motif: 'Quota Claude atteint', cause: 'quota', le: MAINTENANT, repriseEstimee: null } });
    const r = transition(bloque, EVENEMENTS.RELANCER, 'utilisatrice', CTX);
    expect(r.ok && r.ticket).toMatchObject({ colonne: 'dev', runEnCours: 'dev', blocage: null });
  });
});
