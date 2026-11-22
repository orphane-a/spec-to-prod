import { randomUUID } from 'node:crypto';
import { CONTROLES_INITIAUX, ETAPES_INITIALES } from '../../domaine/colonnes';
import type { CauseBlocage, Colonne, Commentaire, Nature, Origine, SujetCommentaire, EntreeJournal, EvenementJournal, Ticket, TypeRun } from '../../domaine/types';
import type { TicketImporte } from '../import/kanban-artefact';
import { enTransaction, type Base } from './connexion';

type Ligne = Record<string, string | number | null>;

export interface Projet {
  id: number;
  nom: string;
  depot: string | null;
  urlPreprod: string | null;
  urlProd: string | null;
  /** Branche par défaut du dépôt : les pipelines y sont lancés et la prod y fusionne. */
  branchePrincipale: string;
}

export interface Quota {
  pourcentageSemaine: number;
  epuise: boolean;
  repriseEstimee: string | null;
  misAJourLe: string;
}

export type StatutRun = 'en_cours' | 'termine' | 'echoue' | 'abandonne';

export interface Run {
  id: string;
  ticketId: number;
  type: TypeRun;
  statut: StatutRun;
  urlSession: string | null;
  debut: string;
  /** Date du dernier signe de vie : lancement ou webhook reçu. */
  derniereNouvelle: string;
  fin: string | null;
}

export interface SaisieTicket {
  titre: string;
  description: string;
  projetId: number | null;
  nature: Nature;
}

/** Provenance d'un ticket créé : fixée à la création, jamais modifiée ensuite. */
export interface Provenance {
  origine: Origine;
  trouveSur: number | null;
}

const texte = (v: unknown) => (v === null || v === undefined ? null : String(v));

function versCommentaire(c: Ligne): Commentaire {
  return {
    id: Number(c.id),
    sujet: c.sujet as SujetCommentaire,
    texte: String(c.texte),
    creeLe: String(c.cree_le),
    prisEnCompteLe: texte(c.pris_en_compte_le),
  };
}

function versTicket(l: Ligne, scenarios: Ligne[], commentaires: Ligne[]): Ticket {
  return {
    id: Number(l.id),
    titre: String(l.titre),
    description: String(l.description),
    projetId: l.projet_id === null ? null : Number(l.projet_id),
    nature: l.nature as Nature,
    origine: l.origine as Origine,
    trouveSur: l.trouve_sur === null ? null : Number(l.trouve_sur),
    colonne: l.colonne as Colonne,
    blocage: l.bloque_motif
      ? {
          motif: String(l.bloque_motif),
          cause: l.bloque_cause as CauseBlocage,
          le: String(l.bloque_le),
          repriseEstimee: texte(l.reprise_estimee),
        }
      : null,
    runEnCours: (l.run_en_cours as TypeRun | null) ?? null,
    spec: texte(l.spec_markdown),
    specVersion: Number(l.spec_version),
    design: texte(l.design_markdown),
    urlMaquette: texte(l.url_maquette),
    designVersion: Number(l.design_version),
    branche: texte(l.branche),
    iteration: Number(l.iteration),
    iterationMax: Number(l.iteration_max),
    controles: JSON.parse(String(l.controles_dev)),
    etapesDeploiement: JSON.parse(String(l.etapes_deploiement)),
    scenarios: scenarios.map((s) => ({
      id: Number(s.ordre),
      objectif: String(s.objectif),
      etapes: String(s.etapes),
      resultatAttendu: String(s.resultat_attendu),
      fait: Number(s.fait) === 1,
    })),
    commentaires: commentaires.map(versCommentaire),
    urlPreprod: texte(l.url_preprod),
    versionDeployee: texte(l.version_deployee),
    deployeLe: texte(l.deploye_le),
    creeLe: String(l.cree_le),
    modifieLe: String(l.modifie_le),
  };
}

export class DepotTickets {
  constructor(
    private readonly base: Base,
    private readonly iterationMax: number,
  ) {}

  lister(): Ticket[] {
    const lignes = this.base.prepare('SELECT * FROM tickets ORDER BY modifie_le DESC, id DESC').all() as Ligne[];
    const scenarios = this.base.prepare('SELECT * FROM scenarios ORDER BY ticket_id, ordre').all() as Ligne[];
    const commentaires = this.base.prepare('SELECT * FROM commentaires ORDER BY ticket_id, id').all() as Ligne[];
    return lignes.map((l) =>
      versTicket(
        l,
        scenarios.filter((s) => s.ticket_id === l.id),
        commentaires.filter((c) => c.ticket_id === l.id),
      ),
    );
  }

  lire(id: number): Ticket | null {
    const ligne = this.base.prepare('SELECT * FROM tickets WHERE id = ?').get(id) as Ligne | undefined;
    if (!ligne) return null;
    const scenarios = this.base.prepare('SELECT * FROM scenarios WHERE ticket_id = ? ORDER BY ordre').all(id) as Ligne[];
    const commentaires = this.base.prepare('SELECT * FROM commentaires WHERE ticket_id = ? ORDER BY id').all(id) as Ligne[];
    return versTicket(ligne, scenarios, commentaires);
  }

  creer(saisie: SaisieTicket, maintenant: string, provenance: Provenance = { origine: 'utilisatrice', trouveSur: null }): Ticket {
    const { lastInsertRowid } = this.base
      .prepare(
        `INSERT INTO tickets (titre, description, projet_id, nature, origine, trouve_sur, colonne, iteration_max, controles_dev, etapes_deploiement, cree_le, modifie_le)
         VALUES (?, ?, ?, ?, ?, ?, 'backlog', ?, ?, ?, ?, ?)`,
      )
      .run(
        saisie.titre,
        saisie.description,
        saisie.projetId,
        saisie.nature,
        provenance.origine,
        provenance.trouveSur,
        this.iterationMax,
        JSON.stringify(CONTROLES_INITIAUX),
        JSON.stringify(ETAPES_INITIALES),
        maintenant,
        maintenant,
      );
    return this.lire(Number(lastInsertRowid))!;
  }

  /** Reprend un ticket venu d'un ancien kanban, avec son état et son journal d'origine. */
  importer(projetId: number, t: TicketImporte): Ticket {
    return enTransaction(this.base, () => {
      const { lastInsertRowid } = this.base
        .prepare(
          `INSERT INTO tickets (titre, description, projet_id, colonne, spec_markdown, spec_version, branche, iteration, iteration_max,
             controles_dev, etapes_deploiement, url_preprod, deploye_le, cree_le, modifie_le)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          t.titre,
          t.description,
          projetId,
          t.colonne,
          t.spec,
          t.spec ? 1 : 0,
          t.branche,
          t.iteration,
          Math.max(this.iterationMax, t.iteration),
          JSON.stringify(t.controles),
          JSON.stringify(t.etapesDeploiement),
          t.urlPreprod,
          t.deployeLe,
          t.creeLe,
          t.modifieLe,
        );
      const id = Number(lastInsertRowid);
      const scenario = this.base.prepare(
        'INSERT INTO scenarios (ticket_id, ordre, objectif, etapes, resultat_attendu, fait) VALUES (?, ?, ?, ?, ?, ?)',
      );
      t.scenarios.forEach((s, i) => scenario.run(id, i + 1, s.objectif, s.etapes, s.resultatAttendu, t.colonne === 'done' ? 1 : 0));
      const journal = this.base.prepare('INSERT INTO journal (ticket_id, date, type, detail) VALUES (?, ?, ?, ?)');
      for (const e of t.journal) journal.run(id, e.date, e.type, e.detail);
      return this.lire(id)!;
    });
  }

  existeDansProjet(projetId: number, titre: string): boolean {
    return this.base.prepare('SELECT 1 FROM tickets WHERE projet_id = ? AND titre = ?').get(projetId, titre) !== undefined;
  }

  modifier(id: number, saisie: SaisieTicket, maintenant: string): Ticket | null {
    this.base
      .prepare('UPDATE tickets SET titre = ?, description = ?, projet_id = ?, nature = ?, modifie_le = ? WHERE id = ?')
      .run(saisie.titre, saisie.description, saisie.projetId, saisie.nature, maintenant, id);
    return this.lire(id);
  }

  /** Autre ticket du projet qui occupe la préprod : en test, ou en cours de déploiement en préprod. */
  occupantPreprod(projetId: number, saufTicketId: number): number | null {
    const ligne = this.base
      .prepare(
        `SELECT id FROM tickets WHERE projet_id = ? AND id != ? AND (colonne = 'test' OR run_en_cours = 'preprod')
         ORDER BY modifie_le LIMIT 1`,
      )
      .get(projetId, saufTicketId) as Ligne | undefined;
    return ligne ? Number(ligne.id) : null;
  }

  supprimer(id: number): void {
    this.base.prepare('DELETE FROM tickets WHERE id = ?').run(id);
  }

  /** Enregistre l'état complet d'un ticket issu de la machine à états, avec son journal. */
  sauver(ticket: Ticket, journal: EntreeJournal[]): void {
    enTransaction(this.base, () => {
      this.base
        .prepare(
          `UPDATE tickets SET colonne = ?, bloque_motif = ?, bloque_cause = ?, bloque_le = ?, reprise_estimee = ?,
             run_en_cours = ?, spec_markdown = ?, spec_version = ?, design_markdown = ?, url_maquette = ?, design_version = ?,
             branche = ?, iteration = ?, iteration_max = ?,
             controles_dev = ?, etapes_deploiement = ?, url_preprod = ?, version_deployee = ?, deploye_le = ?, modifie_le = ?
           WHERE id = ?`,
        )
        .run(
          ticket.colonne,
          ticket.blocage?.motif ?? null,
          ticket.blocage?.cause ?? null,
          ticket.blocage?.le ?? null,
          ticket.blocage?.repriseEstimee ?? null,
          ticket.runEnCours,
          ticket.spec,
          ticket.specVersion,
          ticket.design,
          ticket.urlMaquette,
          ticket.designVersion,
          ticket.branche,
          ticket.iteration,
          ticket.iterationMax,
          JSON.stringify(ticket.controles),
          JSON.stringify(ticket.etapesDeploiement),
          ticket.urlPreprod,
          ticket.versionDeployee,
          ticket.deployeLe,
          ticket.modifieLe,
          ticket.id,
        );
      this.base.prepare('DELETE FROM scenarios WHERE ticket_id = ?').run(ticket.id);
      const insertion = this.base.prepare(
        'INSERT INTO scenarios (ticket_id, ordre, objectif, etapes, resultat_attendu, fait) VALUES (?, ?, ?, ?, ?, ?)',
      );
      for (const s of ticket.scenarios) {
        insertion.run(ticket.id, s.id, s.objectif, s.etapes, s.resultatAttendu, s.fait ? 1 : 0);
      }
      this.journaliserSansTransaction(ticket.id, journal, ticket.modifieLe);
    });
  }

  /**
   * Correction à la main de la spec : seuls les champs de la spec changent, dans la même transaction que le journal.
   * Pas de `sauver` ici, qui réécrirait tout le ticket et pourrait écraser un webhook arrivé entre temps.
   */
  corrigerSpec(id: number, spec: string, version: number, maintenant: string, journal: EntreeJournal): Ticket {
    return enTransaction(this.base, () => {
      this.base.prepare('UPDATE tickets SET spec_markdown = ?, spec_version = ?, modifie_le = ? WHERE id = ?').run(spec, version, maintenant, id);
      this.journaliserSansTransaction(id, [journal], maintenant);
      return this.lire(id)!;
    });
  }

  /** Correction à la main du design : résumé, lien de la maquette et version, avec son entrée de journal. */
  corrigerDesign(id: number, design: string, urlMaquette: string, version: number, maintenant: string, journal: EntreeJournal): Ticket {
    return enTransaction(this.base, () => {
      this.base
        .prepare('UPDATE tickets SET design_markdown = ?, url_maquette = ?, design_version = ?, modifie_le = ? WHERE id = ?')
        .run(design, urlMaquette, version, maintenant, id);
      this.journaliserSansTransaction(id, [journal], maintenant);
      return this.lire(id)!;
    });
  }

  /** Ajoute un commentaire avec son entrée de journal. Le ticket est daté de cette activité. */
  ajouterCommentaire(ticketId: number, sujet: SujetCommentaire, contenu: string, maintenant: string, journal: EntreeJournal): Ticket {
    return enTransaction(this.base, () => {
      this.base
        .prepare('INSERT INTO commentaires (ticket_id, sujet, texte, cree_le) VALUES (?, ?, ?, ?)')
        .run(ticketId, sujet, contenu, maintenant);
      this.base.prepare('UPDATE tickets SET modifie_le = ? WHERE id = ?').run(maintenant, ticketId);
      this.journaliserSansTransaction(ticketId, [journal], maintenant);
      return this.lire(ticketId)!;
    });
  }

  /** Supprime un commentaire du ticket, avec son entrée de journal. */
  supprimerCommentaire(ticketId: number, commentaireId: number, maintenant: string, journal: EntreeJournal): Ticket {
    return enTransaction(this.base, () => {
      this.base.prepare('DELETE FROM commentaires WHERE id = ? AND ticket_id = ?').run(commentaireId, ticketId);
      this.base.prepare('UPDATE tickets SET modifie_le = ? WHERE id = ?').run(maintenant, ticketId);
      this.journaliserSansTransaction(ticketId, [journal], maintenant);
      return this.lire(ticketId)!;
    });
  }

  /** Note les commentaires comme transmis à une session Claude. Seuls ceux encore en attente changent. */
  marquerCommentairesTransmis(ticketId: number, ids: number[], maintenant: string, journal: EntreeJournal): void {
    enTransaction(this.base, () => {
      const marque = this.base.prepare('UPDATE commentaires SET pris_en_compte_le = ? WHERE id = ? AND ticket_id = ? AND pris_en_compte_le IS NULL');
      for (const id of ids) marque.run(maintenant, id, ticketId);
      this.journaliserSansTransaction(ticketId, [journal], maintenant);
    });
  }

  marquerScenario(ticketId: number, ordre: number, fait: boolean): boolean {
    const { changes } = this.base
      .prepare('UPDATE scenarios SET fait = ? WHERE ticket_id = ? AND ordre = ?')
      .run(fait ? 1 : 0, ticketId, ordre);
    return Number(changes) > 0;
  }

  journaliser(ticketId: number, entrees: EntreeJournal[], date: string): void {
    enTransaction(this.base, () => this.journaliserSansTransaction(ticketId, entrees, date));
  }

  private journaliserSansTransaction(ticketId: number, entrees: EntreeJournal[], date: string): void {
    const insertion = this.base.prepare('INSERT INTO journal (ticket_id, date, type, detail) VALUES (?, ?, ?, ?)');
    for (const e of entrees) insertion.run(ticketId, date, e.type, e.detail);
  }

  journal(ticketId: number): EvenementJournal[] {
    const lignes = this.base.prepare('SELECT * FROM journal WHERE ticket_id = ? ORDER BY date, id').all(ticketId) as Ligne[];
    return lignes.map((l) => ({
      id: Number(l.id),
      ticketId: Number(l.ticket_id),
      date: String(l.date),
      type: l.type as EvenementJournal['type'],
      detail: String(l.detail),
    }));
  }
}

export class DepotRuns {
  constructor(private readonly base: Base) {}

  /** Crée un run et abandonne les runs encore ouverts du ticket : seul le dernier compte. */
  ouvrir(ticketId: number, type: TypeRun, maintenant: string): Run {
    const id = randomUUID();
    enTransaction(this.base, () => {
      this.base
        .prepare("UPDATE runs SET statut = 'abandonne', fin = ? WHERE ticket_id = ? AND statut = 'en_cours'")
        .run(maintenant, ticketId);
      this.base
        .prepare("INSERT INTO runs (id, ticket_id, type, statut, debut, derniere_nouvelle) VALUES (?, ?, ?, 'en_cours', ?, ?)")
        .run(id, ticketId, type, maintenant, maintenant);
    });
    return this.lire(id)!;
  }

  /** Note un signe de vie du run (webhook reçu). */
  signalerNouvelle(id: string, maintenant: string): void {
    this.base.prepare("UPDATE runs SET derniere_nouvelle = ? WHERE id = ? AND statut = 'en_cours'").run(maintenant, id);
  }

  /** Runs encore ouverts dont la dernière nouvelle est antérieure à la date donnée. */
  silencieuxDepuis(limite: string): Run[] {
    const lignes = this.base
      .prepare("SELECT id FROM runs WHERE statut = 'en_cours' AND derniere_nouvelle < ? ORDER BY derniere_nouvelle")
      .all(limite) as Ligne[];
    return lignes.map((l) => this.lire(String(l.id))!);
  }

  lire(id: string): Run | null {
    const l = this.base.prepare('SELECT * FROM runs WHERE id = ?').get(id) as Ligne | undefined;
    if (!l) return null;
    return {
      id: String(l.id),
      ticketId: Number(l.ticket_id),
      type: l.type as TypeRun,
      statut: l.statut as StatutRun,
      urlSession: texte(l.url_session),
      debut: String(l.debut),
      derniereNouvelle: String(l.derniere_nouvelle),
      fin: texte(l.fin),
    };
  }

  definirSession(id: string, url: string): void {
    this.base.prepare('UPDATE runs SET url_session = ? WHERE id = ?').run(url, id);
  }

  clore(id: string, statut: Exclude<StatutRun, 'en_cours'>, maintenant: string): void {
    this.base.prepare("UPDATE runs SET statut = ?, fin = ? WHERE id = ? AND statut = 'en_cours'").run(statut, maintenant, id);
  }
}

export class DepotProjets {
  constructor(private readonly base: Base) {}

  lister(): Projet[] {
    const lignes = this.base.prepare('SELECT * FROM projets ORDER BY nom').all() as Ligne[];
    return lignes.map((l) => ({
      id: Number(l.id),
      nom: String(l.nom),
      depot: texte(l.depot),
      urlPreprod: texte(l.url_preprod),
      urlProd: texte(l.url_prod),
      branchePrincipale: String(l.branche_principale),
    }));
  }

  existe(id: number): boolean {
    return this.base.prepare('SELECT 1 FROM projets WHERE id = ?').get(id) !== undefined;
  }

  lire(id: number): Projet | null {
    return this.lister().find((p) => p.id === id) ?? null;
  }

  parNom(nom: string): Projet | null {
    return this.lister().find((p) => p.nom === nom) ?? null;
  }
}

export class DepotQuota {
  constructor(private readonly base: Base) {}

  lire(): Quota {
    const l = this.base.prepare('SELECT * FROM quota WHERE id = 1').get() as Ligne;
    return {
      pourcentageSemaine: Number(l.pourcentage_semaine),
      epuise: Number(l.epuise) === 1,
      repriseEstimee: texte(l.reprise_estimee),
      misAJourLe: String(l.mis_a_jour_le),
    };
  }

  ecrire(quota: Omit<Quota, 'misAJourLe'>, maintenant: string): Quota {
    this.base
      .prepare('UPDATE quota SET pourcentage_semaine = ?, epuise = ?, reprise_estimee = ?, mis_a_jour_le = ? WHERE id = 1')
      .run(Math.max(0, Math.min(100, Math.round(quota.pourcentageSemaine))), quota.epuise ? 1 : 0, quota.repriseEstimee, maintenant);
    return this.lire();
  }
}

export interface Depots {
  tickets: DepotTickets;
  runs: DepotRuns;
  projets: DepotProjets;
  quota: DepotQuota;
}

export function creerDepots(base: Base, iterationMax: number): Depots {
  return {
    tickets: new DepotTickets(base, iterationMax),
    runs: new DepotRuns(base),
    projets: new DepotProjets(base),
    quota: new DepotQuota(base),
  };
}
