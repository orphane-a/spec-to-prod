import { CONTROLES_INITIAUX, ETAPES_INITIALES, definitionColonne, nomBranche } from './colonnes';
import {
  TYPES_EVENEMENT,
  type Acteur,
  type Colonne,
  type ContexteTransition,
  type ControlesDev,
  type Effet,
  type EntreeJournal,
  type Evenement,
  type ResultatTransition,
  type Ticket,
  type TypeEvenement,
  type TypeRun,
} from './types';

/**
 * Seule source de vérité des transitions d'un ticket.
 * Fonction pure : elle ne lit ni la base, ni l'horloge, ni le réseau.
 */

interface Regle {
  acteur: Acteur;
  depuis: readonly Colonne[];
}

const REGLES: Record<TypeEvenement, Regle> = {
  LANCER_CONCEPTION: { acteur: 'utilisatrice', depuis: ['backlog'] },
  SPEC_PRETE: { acteur: 'systeme', depuis: ['conception'] },
  LANCER_DESIGN: { acteur: 'utilisatrice', depuis: ['conception'] },
  DESIGN_PRET: { acteur: 'systeme', depuis: ['conception'] },
  LANCER_DEV: { acteur: 'utilisatrice', depuis: ['conception'] },
  ITERATION_TERMINEE: { acteur: 'systeme', depuis: ['dev'] },
  DEV_TERMINE: { acteur: 'systeme', depuis: ['dev'] },
  PREPROD_DEPLOYEE: { acteur: 'systeme', depuis: ['dev'] },
  DEPLOYER_PROD: { acteur: 'utilisatrice', depuis: ['test'] },
  ETAPE_DEPLOIEMENT: { acteur: 'systeme', depuis: ['deploiement'] },
  DEPLOIEMENT_TERMINE: { acteur: 'systeme', depuis: ['deploiement'] },
  ECHEC: { acteur: 'systeme', depuis: ['conception', 'dev', 'deploiement'] },
  // Le déploiement passe par GitHub Actions : il ne consomme pas de quota Claude.
  QUOTA_ATTEINT: { acteur: 'systeme', depuis: ['conception', 'dev'] },
  RELANCER: { acteur: 'utilisatrice', depuis: ['conception', 'dev', 'deploiement'] },
};

/** Run à relancer dans chaque colonne. En conception, seule l'étape qui manque repart. */
const RUN_A_RELANCER: Partial<Record<Colonne, (ticket: Ticket) => TypeRun>> = {
  conception: (ticket) => (ticket.spec?.trim() ? 'design' : 'spec'),
  // Dev déjà au vert avec ses scénarios : seule la préprod repart.
  // Sauf en cas de conflit avec la branche principale : le dev remet la branche à jour.
  dev: (ticket) =>
    ticket.blocage?.cause !== 'conflit' && ticket.scenarios.length >= SCENARIOS_MINIMUM && toutEstVert(ticket.controles) ? 'preprod' : 'dev',
  deploiement: () => 'deploiement',
};

/** Runs qui consomment le quota Claude. Les déploiements passent par GitHub Actions. */
const RUNS_CLAUDE: readonly TypeRun[] = ['spec', 'design', 'dev'];

const motifPreprodOccupee = (ticketId: number) => `Préprod occupée par le ticket ${ticketId}.`;

const designPret = (ticket: Ticket) => Boolean(ticket.design?.trim() && ticket.urlMaquette);
const estLienWeb = (url: string) => /^https?:\/\/\S+$/i.test(url.trim());

export const MOTIF_QUOTA = 'Quota Claude atteint';
export const SCENARIOS_MINIMUM = 2;

const refus = (code: Extract<ResultatTransition, { ok: false }>['code'], message: string): ResultatTransition => ({
  ok: false,
  code,
  message,
});

const condition = (message: string) => refus('CONDITION_NON_REMPLIE', message);

const succes = (ticket: Ticket, journal: EntreeJournal[], effets: Effet[] = []): ResultatTransition => ({
  ok: true,
  ticket,
  journal,
  effets,
});

const demarrer = (run: TypeRun): Effet => ({ type: 'DEMARRER_RUN', run });

const libelle = (colonne: Colonne) => definitionColonne(colonne).libelle;

const passage = (de: Colonne, vers: Colonne): EntreeJournal => ({
  type: 'transition',
  detail: `Passage de ${libelle(de)} à ${libelle(vers)}.`,
});

const controlesEnEchec = (c: ControlesDev) => Object.values(c).filter((e) => e !== 'vert').length;
const toutEstVert = (c: ControlesDev) => controlesEnEchec(c) === 0;

export function transition(ticket: Ticket, evenement: Evenement, acteur: Acteur, ctx: ContexteTransition): ResultatTransition {
  const regle = REGLES[evenement.type];

  if (ticket.colonne === 'done') {
    return refus('TICKET_TERMINE', 'Ce ticket est en ligne : il ne bouge plus.');
  }
  if (regle.acteur !== acteur) {
    return refus(
      'ACTEUR_INTERDIT',
      acteur === 'systeme' ? 'Cette décision vous appartient : le système ne peut pas la prendre.' : 'Ce passage est automatique : il ne se déclenche pas à la main.',
    );
  }
  if (ticket.blocage && evenement.type !== 'RELANCER') {
    return refus('TICKET_BLOQUE', `Ticket bloqué : ${ticket.blocage.motif}`);
  }
  if (!regle.depuis.includes(ticket.colonne)) {
    return refus('TRANSITION_INTERDITE', `Action impossible depuis la colonne ${libelle(ticket.colonne)}.`);
  }

  const t: Ticket = { ...ticket, modifieLe: ctx.maintenant };

  switch (evenement.type) {
    case 'LANCER_CONCEPTION':
      return succes(
        // La branche est fixée dès maintenant : la maquette y sera commitée.
        { ...t, colonne: 'conception', runEnCours: 'spec', branche: ticket.branche ?? nomBranche(ticket.id, ticket.titre) },
        [passage('backlog', 'conception'), { type: 'action', detail: 'Vous avez lancé la conception. Claude rédige la spec.' }],
        [demarrer('spec')],
      );

    case 'SPEC_PRETE': {
      if (ticket.runEnCours !== 'spec') return condition('Aucune rédaction de spec en cours.');
      if (!evenement.spec.trim()) return condition('La spec reçue est vide.');
      const version = ticket.specVersion + 1;
      return succes(
        { ...t, spec: evenement.spec, specVersion: version, runEnCours: 'design' },
        [
          { type: 'spec', detail: `Spec prête, version ${version}.` },
          { type: 'action', detail: 'Claude conçoit la maquette.' },
        ],
        [demarrer('design')],
      );
    }

    case 'LANCER_DESIGN':
      if (ticket.runEnCours) return condition('Attendez la fin du run en cours.');
      if (!ticket.spec?.trim()) return condition('Le design demande une spec rattachée au ticket.');
      if (designPret(ticket)) return condition('Ce ticket a déjà son design.');
      return succes(
        { ...t, runEnCours: 'design', branche: ticket.branche ?? nomBranche(ticket.id, ticket.titre) },
        [{ type: 'action', detail: 'Vous avez lancé le design. Claude conçoit la maquette.' }],
        [demarrer('design')],
      );

    case 'DESIGN_PRET': {
      if (ticket.runEnCours !== 'design') return condition('Aucun design en cours.');
      if (!evenement.resume.trim()) return condition('Le résumé du design est vide.');
      if (!estLienWeb(evenement.urlMaquette)) return condition('La maquette doit être un lien web.');
      const version = ticket.designVersion + 1;
      return succes({ ...t, design: evenement.resume, urlMaquette: evenement.urlMaquette.trim(), designVersion: version, runEnCours: null }, [
        { type: 'design', detail: `Design prêt, version ${version}. Maquette : ${evenement.urlMaquette.trim()}` },
      ]);
    }

    case 'LANCER_DEV': {
      if (!ticket.spec?.trim()) return condition('Lancer le dev demande une spec rattachée au ticket.');
      if (ticket.runEnCours) return condition('Attendez la fin de la conception.');
      const branche = ticket.branche ?? nomBranche(ticket.id, ticket.titre);
      return succes(
        { ...t, colonne: 'dev', runEnCours: 'dev', branche, iteration: 0, controles: { ...CONTROLES_INITIAUX } },
        [passage('conception', 'dev'), { type: 'action', detail: `Vous avez lancé le dev sur la branche ${branche}.` }],
        [demarrer('dev')],
      );
    }

    case 'ITERATION_TERMINEE': {
      if (ticket.runEnCours !== 'dev') return condition('Aucune boucle de dev en cours.');
      if (evenement.iteration <= ticket.iteration) return condition('Le numéro d’itération doit progresser.');
      const suivant: Ticket = { ...t, iteration: evenement.iteration, controles: evenement.controles };
      const journal: EntreeJournal[] = [
        { type: 'iteration', detail: `Itération ${evenement.iteration} sur ${ticket.iterationMax} terminée.` },
        { type: 'test', detail: resumeControles(evenement.controles) },
      ];
      const echecs = controlesEnEchec(evenement.controles);
      const depasse = evenement.iteration > ticket.iterationMax;
      const auMaximumSansSucces = evenement.iteration >= ticket.iterationMax && echecs > 0;
      if (depasse || auMaximumSansSucces) {
        const motif = `${ticket.iterationMax} itérations atteintes, ${echecs} ${echecs > 1 ? 'contrôles échouent' : 'contrôle échoue'}.`;
        return succes({ ...suivant, runEnCours: null, blocage: { motif, cause: 'iterations', le: ctx.maintenant, repriseEstimee: null } }, [
          ...journal,
          { type: 'blocage', detail: `Bloqué : ${motif}` },
        ]);
      }
      return succes(suivant, journal);
    }

    case 'DEV_TERMINE': {
      if (ticket.runEnCours !== 'dev') return condition('Aucune boucle de dev en cours.');
      if (!toutEstVert(evenement.controles)) return condition('Tous les contrôles doivent être au vert avant le passage en test.');
      if (evenement.scenarios.length < SCENARIOS_MINIMUM) {
        return condition('Il faut au moins deux scénarios de test : le cas nominal et un cas d’erreur.');
      }
      const scenarios = evenement.scenarios.map((s, i) => ({ ...s, id: i + 1, fait: false }));
      const termine: Ticket = { ...t, controles: evenement.controles, scenarios };
      const journal: EntreeJournal[] = [
        { type: 'test', detail: resumeControles(evenement.controles) },
        { type: 'action', detail: `Dev terminé, ${scenarios.length} scénarios de test écrits.` },
      ];
      if (ctx.preprodOccupeePar) {
        const motif = motifPreprodOccupee(ctx.preprodOccupeePar);
        return succes({ ...termine, runEnCours: null, blocage: { motif, cause: 'echec', le: ctx.maintenant, repriseEstimee: null } }, [
          ...journal,
          { type: 'blocage', detail: `Bloqué : ${motif}` },
        ]);
      }
      return succes({ ...termine, runEnCours: 'preprod' }, [...journal, { type: 'deploiement', detail: 'Déploiement en préprod lancé.' }], [demarrer('preprod')]);
    }

    case 'PREPROD_DEPLOYEE': {
      if (ticket.runEnCours !== 'preprod') return condition('Aucun déploiement en préprod en cours.');
      if (!estLienWeb(evenement.urlPreprod)) return condition('La préprod doit être un lien web.');
      if (!evenement.version.trim()) return condition('La version déployée en préprod est obligatoire.');
      const url = evenement.urlPreprod.trim();
      return succes({ ...t, colonne: 'test', runEnCours: null, urlPreprod: url }, [
        { type: 'deploiement', detail: `Préprod à jour, version ${evenement.version.trim()} : ${url}` },
        passage('dev', 'test'),
      ]);
    }

    case 'DEPLOYER_PROD':
      if (!evenement.confirmation) return condition('La mise en prod demande votre confirmation explicite.');
      return succes(
        { ...t, colonne: 'deploiement', runEnCours: 'deploiement', etapesDeploiement: { ...ETAPES_INITIALES } },
        [passage('test', 'deploiement'), { type: 'action', detail: 'Vous avez confirmé la mise en prod.' }],
        [demarrer('deploiement')],
      );

    case 'ETAPE_DEPLOIEMENT':
      if (ticket.runEnCours !== 'deploiement') return condition('Aucun déploiement en cours.');
      return succes({ ...t, etapesDeploiement: evenement.etapes }, [
        { type: 'deploiement', detail: resumeEtapes(evenement.etapes) },
      ]);

    case 'DEPLOIEMENT_TERMINE':
      if (ticket.runEnCours !== 'deploiement') return condition('Aucun déploiement en cours.');
      if (!evenement.version.trim()) return condition('La version déployée est obligatoire.');
      return succes(
        {
          ...t,
          colonne: 'done',
          runEnCours: null,
          versionDeployee: evenement.version,
          deployeLe: ctx.maintenant,
          etapesDeploiement: { fusion: 'vert', envoi: 'vert', verification: 'vert' },
        },
        [{ type: 'deploiement', detail: `Version ${evenement.version} en ligne.` }, passage('deploiement', 'done')],
      );

    case 'ECHEC': {
      if (!ticket.runEnCours) return condition('Aucun run en cours ne peut échouer.');
      const motif = evenement.motif.trim() || 'Étape en échec.';
      // Seul un conflit en préprod renvoie au dev : en prod, le ticket ne quitte pas sa colonne.
      const cause = evenement.conflit && ticket.runEnCours === 'preprod' ? 'conflit' : 'echec';
      return succes({ ...t, runEnCours: null, blocage: { motif, cause, le: ctx.maintenant, repriseEstimee: null } }, [
        { type: 'blocage', detail: `Bloqué : ${motif}` },
      ]);
    }

    case 'QUOTA_ATTEINT':
      if (!ticket.runEnCours) return condition('Aucun run en cours.');
      if (!RUNS_CLAUDE.includes(ticket.runEnCours)) return condition('Ce déploiement ne consomme pas de quota Claude.');
      return succes(
        {
          ...t,
          runEnCours: null,
          blocage: { motif: MOTIF_QUOTA, cause: 'quota', le: ctx.maintenant, repriseEstimee: evenement.repriseEstimee },
        },
        [{ type: 'blocage', detail: `Bloqué : ${MOTIF_QUOTA}.` }],
      );

    case 'RELANCER': {
      if (!ticket.blocage) return condition('Seul un ticket bloqué peut être relancé.');
      const run = RUN_A_RELANCER[ticket.colonne]?.(ticket);
      if (!run) return refus('TRANSITION_INTERDITE', 'Rien à relancer dans cette colonne.');
      if (run === 'preprod' && ctx.preprodOccupeePar) return condition(motifPreprodOccupee(ctx.preprodOccupeePar));
      const relance: Ticket = { ...t, blocage: null, runEnCours: run };
      if (run === 'dev') Object.assign(relance, { iteration: 0, controles: { ...CONTROLES_INITIAUX } });
      if (run === 'deploiement') relance.etapesDeploiement = { ...ETAPES_INITIALES };
      return succes(relance, [{ type: 'deblocage', detail: `Vous avez relancé le ticket après : ${ticket.blocage.motif}` }], [demarrer(run)]);
    }
  }
}

/** Actions que l'utilisatrice peut déclencher maintenant sur ce ticket. */
export function actionsDisponibles(ticket: Ticket): TypeEvenement[] {
  const ctx = { maintenant: ticket.modifieLe };
  return TYPES_EVENEMENT.filter((type) => REGLES[type].acteur === 'utilisatrice').filter((type) => {
    const evenement = (type === 'DEPLOYER_PROD' ? { type, confirmation: true } : { type }) as Evenement;
    return transition(ticket, evenement, 'utilisatrice', ctx).ok;
  });
}

/** Seul le backlog accepte la modification. */
export function estModifiable(ticket: Ticket): boolean {
  return ticket.colonne === 'backlog';
}

/**
 * Un ticket se supprime dans toute colonne, sauf pendant un run :
 * un webhook arriverait pour un ticket disparu, et un déploiement en prod serait coupé.
 */
export function estSupprimable(ticket: Ticket): boolean {
  return ticket.runEnCours === null;
}

const LIBELLES_ETAT = { en_attente: 'en attente', en_cours: 'en cours', vert: 'vert', rouge: 'rouge' } as const;

function resumeControles(c: ControlesDev): string {
  return `Tests unitaires ${LIBELLES_ETAT[c.unitaires]}, non régression ${LIBELLES_ETAT[c.non_regression]}, test exploratoire ${LIBELLES_ETAT[c.exploratoire]}.`;
}

function resumeEtapes(e: Ticket['etapesDeploiement']): string {
  return `Fusion ${LIBELLES_ETAT[e.fusion]}, envoi ${LIBELLES_ETAT[e.envoi]}, vérification ${LIBELLES_ETAT[e.verification]}.`;
}
