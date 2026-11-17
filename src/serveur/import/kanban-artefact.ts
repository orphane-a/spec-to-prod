import { CONTROLES_INITIAUX, ETAPES_INITIALES } from '../../domaine/colonnes';
import type { Colonne, ControlesDev, EtapesDeploiement, ScenarioSaisie, TypeJournal } from '../../domaine/types';

/**
 * Conversion des cartes des anciens kanbans en artefact (Optivie, Elections 2027)
 * vers des tickets Spec to prod. Fonction pure : aucune écriture ici.
 */

type Brut = Record<string, unknown>;

export interface TicketImporte {
  reference: string;
  titre: string;
  description: string;
  colonne: Colonne;
  spec: string | null;
  branche: string | null;
  iteration: number;
  controles: ControlesDev;
  etapesDeploiement: EtapesDeploiement;
  scenarios: ScenarioSaisie[];
  urlPreprod: string | null;
  deployeLe: string | null;
  creeLe: string;
  modifieLe: string;
  journal: { date: string; type: TypeJournal; detail: string }[];
}

const COLONNES_SOURCE: Record<string, Colonne> = {
  backlog: 'backlog',
  spec: 'conception',
  dev: 'dev',
  test_ia: 'test',
  testia: 'test',
  test_anne: 'test',
  testanne: 'test',
  deploy: 'deploiement',
  deployer: 'deploiement',
  done: 'done',
};

const texte = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const liste = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function dateValide(v: unknown): string | null {
  const t = texte(v);
  return t && !Number.isNaN(Date.parse(t)) ? new Date(t).toISOString() : null;
}

function nettoyerTitre(t: string): string {
  return t.replace(/^Lot\s*\d+\s*·\s*/, '').trim() || 'Sans titre';
}

function scenario(s: unknown): ScenarioSaisie | null {
  if (typeof s === 'string') {
    const t = s.trim();
    return t ? { objectif: t.split(/[.:]/)[0]!.slice(0, 120).trim() || t.slice(0, 120), etapes: t, resultatAttendu: 'Voir les étapes.' } : null;
  }
  if (!s || typeof s !== 'object') return null;
  const o = s as Brut;
  const etapes = liste(o.etapes).map(texte).filter(Boolean);
  const prerequis = Array.isArray(o.prerequis) ? o.prerequis.map(texte).join(', ') : texte(o.prerequis);
  const limites = liste(o.casLimites).map(texte).filter(Boolean);
  const corps = [
    prerequis ? `Prérequis : ${prerequis}` : '',
    etapes.map((e, i) => `${i + 1}. ${e}`).join('\n'),
    limites.length ? `Cas limites :\n${limites.map((l) => `- ${l}`).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  const objectif = texte(o.titre) || 'Scénario';
  return { objectif, etapes: corps || objectif, resultatAttendu: texte(o.attendu) || 'Voir les étapes.' };
}

function entreeJournal(h: unknown, repli: string): { date: string; type: TypeJournal; detail: string } | null {
  if (!h || typeof h !== 'object') return null;
  const o = h as Brut;
  const transition = texte(o.transition);
  const resultat = texte(o.result) || texte(o.resultat);
  const lien = texte(o.link) || texte(o.lien);
  const detail = [transition && resultat ? `${transition} : ${resultat}` : transition || resultat, lien].filter(Boolean).join(' ');
  if (!detail) return null;
  const type: TypeJournal = /création/i.test(transition) ? 'action' : /test/i.test(transition) ? 'test' : 'transition';
  return { date: dateValide(o.at) ?? dateValide(o.date) ?? repli, type, detail };
}

/** Renvoie null pour une carte supprimée ou sans colonne connue (signalé par l'appelant). */
export function convertirCarte(carte: Brut, kanban: string, urlPreprodProjet: string | null): TicketImporte | null {
  if (carte.deleted) return null;
  const colonne = COLONNES_SOURCE[texte(carte.status)];
  if (!colonne) return null;

  const reference = texte(carte.id);
  const resume = texte(carte.specSummary);
  const criteres = [...liste(carte.acceptance), ...liste(carte.criteres)].map(texte).filter(Boolean);
  const changements = liste(carte.changes).map(texte).filter(Boolean);
  const lienSpec = texte(carte.specLink);
  const pr = texte(carte.prUrl);
  const epic = texte(carte.epic) || texte(carte.lotNom);
  const origine = texte(carte.ref);
  const priorite = texte(carte.priority);

  const description = [
    resume,
    criteres.length ? `Critères d'acceptation :\n${criteres.map((c) => `- ${c}`).join('\n')}` : '',
    changements.length ? `Changements visibles :\n${changements.map((c) => `- ${c}`).join('\n')}` : '',
    [
      `Carte ${reference} du kanban ${kanban}`,
      epic ? `epic ${epic}` : '',
      priorite ? `priorité ${priorite}` : '',
      origine,
    ]
      .filter(Boolean)
      .join(', ') + '.',
    lienSpec ? `Spec : ${lienSpec}` : '',
    pr ? `Pull request : ${pr}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const modifieLe = dateValide(carte.updatedAt) ?? new Date(0).toISOString();
  const journal = liste(carte.history)
    .map((h) => entreeJournal(h, modifieLe))
    .filter((e): e is NonNullable<typeof e> => e !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
  journal.push({ date: modifieLe, type: 'action', detail: `Ticket importé depuis le kanban ${kanban} (carte ${reference}).` });
  const creeLe = journal[0]!.date;

  const avance = colonne === 'test' || colonne === 'deploiement' || colonne === 'done';
  const branche = texte(carte.branch);
  const vert = { unitaires: 'vert', non_regression: 'vert', exploratoire: 'vert' } as const;
  const scenarios = liste(carte.testScenarios)
    .map(scenario)
    .filter((s): s is ScenarioSaisie => s !== null);

  return {
    reference,
    titre: nettoyerTitre(texte(carte.titre)),
    description,
    colonne,
    spec: colonne === 'backlog' ? null : description,
    branche: branche && !/^(main|master)$/.test(branche) ? branche : null,
    iteration: Math.max(0, Number(carte.iteration) || 0),
    controles: avance ? { ...vert } : { ...CONTROLES_INITIAUX },
    etapesDeploiement: colonne === 'done' ? { fusion: 'vert', envoi: 'vert', verification: 'vert' } : { ...ETAPES_INITIALES },
    scenarios,
    urlPreprod: colonne === 'test' ? texte(carte.preprodUrl) || urlPreprodProjet : texte(carte.preprodUrl) || null,
    deployeLe: colonne === 'done' ? modifieLe : null,
    creeLe,
    modifieLe,
    journal,
  };
}
