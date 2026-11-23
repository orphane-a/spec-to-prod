import type { ZodType } from 'zod';
import { commentaireSaisieSchema, commentairesATransmettre, detailJournalAjout, detailJournalTransmission, relanceParCommentaires } from '../domaine/commentaires';
import { correctionDesignSchema, correctionSpecSchema, detailJournalDesign, detailJournalSpec, refusCorrection } from '../domaine/correction-manuelle';
import { estModifiable, estSupprimable, transition } from '../domaine/machine-etats';
import type { Acteur, Commentaire, Effet, Evenement, Nature, Ticket } from '../domaine/types';
import type { Depots, SaisieTicket } from './base/depots';
import type { Diffuseur } from './diffuseur';
import { ErreurMetier, introuvable } from './erreurs';
import { QuotaAtteintErreur, type Executeurs } from './relais/executeur';
import { TAILLE_MAX_TEXTE } from './relais/reel';

/** Place gardée dans la demande au dev pour le titre, la description, le projet et le lien du relais. */
const MARGE_CHARGE = 20_000;

function validerCorrection<T>(schema: ZodType<T>, corps: unknown): T {
  const resultat = schema.safeParse(corps);
  if (!resultat.success) {
    throw new ErreurMetier(400, 'DONNEES_INVALIDES', resultat.error.issues[0]?.message ?? 'Données invalides.');
  }
  return resultat.data;
}

const MESSAGE_CORRECTION_TROP_LONGUE = 'La spec et le design réunis sont trop longs pour la session de dev. Raccourcis le texte.';

/** Commentaires en attente, sous la forme où ils partent dans la charge de la session. */
const enAttente = (commentaires: Commentaire[]) =>
  commentaires.filter((c) => c.prisEnCompteLe === null).map(({ sujet, texte, creeLe }) => ({ sujet, texte, le: creeLe }));

export type Horloge = () => string;
export const horlogeSysteme: Horloge = () => new Date().toISOString();

/** Bugs ouverts qu'un même ticket peut signaler : au delà, l'agent de test s'emballe. */
export const BUGS_OUVERTS_MAX = 10;

export interface BugSignale {
  titre: string;
  description: string;
}

export type ResultatReception = { ignore: false; ticket: Ticket } | { ignore: true; raison: string };

/**
 * Orchestration : lit le ticket, demande la permission à la machine à états,
 * enregistre, diffuse, puis exécute les effets (démarrage des runs).
 */
export class ServiceTickets {
  constructor(
    private readonly depots: Depots,
    private readonly executeurs: Executeurs,
    private readonly diffuseur: Diffuseur,
    private readonly horloge: Horloge = horlogeSysteme,
  ) {}

  lister(): Ticket[] {
    return this.depots.tickets.lister();
  }

  lire(id: number): Ticket {
    const ticket = this.depots.tickets.lire(id);
    if (!ticket) throw introuvable();
    return ticket;
  }

  creer(saisie: SaisieTicket): Ticket {
    this.verifierProjet(saisie.projetId);
    const maintenant = this.horloge();
    const ticket = this.depots.tickets.creer(saisie, maintenant);
    const detail = saisie.nature === 'bug' ? 'Bug signalé, ajouté au backlog.' : 'Ticket ajouté au backlog.';
    this.depots.tickets.journaliser(ticket.id, [{ type: 'action', detail }], maintenant);
    this.diffuseur.publier({ type: 'ticket', ticket });
    return ticket;
  }

  modifier(id: number, saisie: Omit<SaisieTicket, 'nature'> & { nature?: Nature }): Ticket {
    const ticket = this.lire(id);
    if (!estModifiable(ticket)) throw new ErreurMetier(409, 'NON_MODIFIABLE', 'Seuls les tickets du backlog se modifient.');
    this.verifierProjet(saisie.projetId);
    const maintenant = this.horloge();
    const modifie = this.depots.tickets.modifier(id, { ...saisie, nature: saisie.nature ?? ticket.nature }, maintenant)!;
    this.depots.tickets.journaliser(id, [{ type: 'action', detail: 'Ticket modifié.' }], maintenant);
    this.diffuseur.publier({ type: 'ticket', ticket: modifie });
    return modifie;
  }

  /**
   * Bug hors périmètre trouvé par l'agent de test exploratoire pendant un dev.
   * Il arrive dans le backlog du même projet et ne démarre jamais seul : la correction reste une décision manuelle.
   * Un doublon (même titre, même ticket d'origine) renvoie le bug déjà créé, car le script de signalement réessaie.
   */
  signalerBug(runId: string, bug: BugSignale): { ticket: Ticket; nouveau: boolean } {
    const run = this.depots.runs.lire(runId);
    if (!run) throw introuvable('Run');
    if (run.type !== 'dev' || run.statut !== 'en_cours') {
      throw new ErreurMetier(409, 'RUN_INACTIF', 'Seule une session de dev en cours peut signaler un bug.');
    }
    const source = this.lire(run.ticketId);
    const existants = this.depots.tickets.lister().filter((t) => t.trouveSur === source.id);
    const doublon = existants.find((t) => t.titre === bug.titre);
    if (doublon) return { ticket: doublon, nouveau: false };
    if (existants.filter((t) => t.colonne !== 'done').length >= BUGS_OUVERTS_MAX) {
      throw new ErreurMetier(429, 'TROP_DE_BUGS', `Ce ticket a déjà ${BUGS_OUVERTS_MAX} bugs ouverts signalés par l’agent de test.`);
    }
    const maintenant = this.horloge();
    const ticket = this.depots.tickets.creer({ ...bug, projetId: source.projetId, nature: 'bug' }, maintenant, { origine: 'agent', trouveSur: source.id });
    this.depots.tickets.journaliser(ticket.id, [{ type: 'action', detail: `Bug trouvé par l’agent de test pendant le dev de « ${source.titre} ».` }], maintenant);
    this.depots.tickets.journaliser(
      source.id,
      [{ type: 'test', detail: `L’agent de test a signalé un bug hors du périmètre : « ${ticket.titre} » (ticket ${ticket.id}).` }],
      maintenant,
    );
    this.diffuseur.publier({ type: 'ticket', ticket });
    return { ticket, nouveau: true };
  }

  supprimer(id: number): void {
    const ticket = this.lire(id);
    if (!estSupprimable(ticket)) {
      throw new ErreurMetier(409, 'NON_SUPPRIMABLE', 'Un run est en cours, attends sa fin pour supprimer ce ticket.');
    }
    this.depots.tickets.supprimer(id);
    this.diffuseur.publier({ type: 'ticket_supprime', id });
  }

  marquerScenario(id: number, ordre: number, fait: boolean): Ticket {
    const ticket = this.lire(id);
    if (ticket.colonne !== 'test') throw new ErreurMetier(409, 'NON_MODIFIABLE', 'Les scénarios se cochent pendant la phase de test.');
    if (!this.depots.tickets.marquerScenario(id, ordre, fait)) throw introuvable('Scénario');
    const scenario = ticket.scenarios.find((s) => s.id === ordre);
    this.depots.tickets.journaliser(
      id,
      [{ type: 'test', detail: `Scénario « ${scenario?.objectif ?? ordre} » marqué ${fait ? 'fait' : 'à faire'}.` }],
      this.horloge(),
    );
    const misAJour = this.lire(id);
    this.diffuseur.publier({ type: 'ticket', ticket: misAJour });
    return misAJour;
  }

  /**
   * Correction à la main de la spec, par exemple après un retour sur la maquette.
   * Ce n'est pas une transition : la machine à états n'intervient pas et le ticket garde sa colonne.
   * Tout est synchrone, de la lecture à l'écriture : aucun webhook ne peut s'intercaler.
   */
  corrigerSpec(id: number, corps: unknown): Ticket {
    const ticket = this.lirePourCorrection(id);
    const { spec } = validerCorrection(correctionSpecSchema, corps);
    this.verifierTailleCharge({ spec, design: ticket.design, urlMaquette: ticket.urlMaquette, commentaires: enAttente(ticket.commentaires) }, MESSAGE_CORRECTION_TROP_LONGUE);
    const version = ticket.specVersion + 1;
    const corrige = this.depots.tickets.corrigerSpec(id, spec, version, this.horloge(), { type: 'spec', detail: detailJournalSpec(version) });
    this.diffuseur.publier({ type: 'ticket', ticket: corrige });
    return corrige;
  }

  /** Correction à la main du design : résumé markdown et lien de la maquette. Même règles que la spec. */
  corrigerDesign(id: number, corps: unknown): Ticket {
    const ticket = this.lirePourCorrection(id);
    const { design, urlMaquette } = validerCorrection(correctionDesignSchema, corps);
    this.verifierTailleCharge({ spec: ticket.spec, design, urlMaquette, commentaires: enAttente(ticket.commentaires) }, MESSAGE_CORRECTION_TROP_LONGUE);
    const version = ticket.designVersion + 1;
    const corrige = this.depots.tickets.corrigerDesign(id, design, urlMaquette, version, this.horloge(), { type: 'design', detail: detailJournalDesign(version) });
    this.diffuseur.publier({ type: 'ticket', ticket: corrige });
    return corrige;
  }

  /**
   * Commentaire sur le ticket. Ce n'est pas une transition : il est permis dans toutes les colonnes,
   * même pendant un run ou quand le ticket est Bloqué, et il attend le prochain run Claude qui le concerne.
   */
  async commenter(id: number, corps: unknown): Promise<Ticket> {
    const ticket = this.lire(id);
    const { sujet, texte } = validerCorrection(commentaireSaisieSchema, corps);
    const maintenant = this.horloge();
    const nouveau: Commentaire = { id: 0, sujet, texte, creeLe: maintenant, prisEnCompteLe: null };
    this.verifierTailleCharge(
      { spec: ticket.spec, design: ticket.design, urlMaquette: ticket.urlMaquette, commentaires: enAttente([...ticket.commentaires, nouveau]) },
      'Les commentaires en attente sont trop longs pour la session Claude. Raccourcis ton commentaire.',
    );
    const commente = this.depots.tickets.ajouterCommentaire(id, sujet, texte, maintenant, { type: 'commentaire', detail: detailJournalAjout(sujet) });
    this.diffuseur.publier({ type: 'ticket', ticket: commente });
    return this.relancerSiCommentaires(commente);
  }

  /** Retire un commentaire tant qu'il n'a pas été transmis à Claude. */
  supprimerCommentaire(id: number, commentaireId: number): Ticket {
    const ticket = this.lire(id);
    const commentaire = ticket.commentaires.find((c) => c.id === commentaireId);
    if (!commentaire) throw introuvable('Commentaire');
    if (commentaire.prisEnCompteLe !== null) {
      throw new ErreurMetier(409, 'COMMENTAIRE_TRANSMIS', 'Ce commentaire a déjà été transmis à Claude, il ne se supprime plus.');
    }
    const misAJour = this.depots.tickets.supprimerCommentaire(id, commentaireId, this.horloge(), { type: 'commentaire', detail: 'Commentaire supprimé.' });
    this.diffuseur.publier({ type: 'ticket', ticket: misAJour });
    return misAJour;
  }

  /** Action déclenchée par l'utilisatrice depuis l'interface. */
  async agir(id: number, evenement: Evenement): Promise<Ticket> {
    const avant = this.lire(id);
    const ticket = await this.appliquer(avant, evenement, 'utilisatrice');
    return ticket;
  }

  /** Événement de fin ou d'avancement d'un run, reçu par webhook signé. */
  async recevoir(runId: string, evenement: Evenement): Promise<ResultatReception> {
    const run = this.depots.runs.lire(runId);
    if (!run) throw introuvable('Run');
    if (run.statut !== 'en_cours') return { ignore: true, raison: 'Run déjà clos.' };

    const avant = this.lire(run.ticketId);
    if (avant.runEnCours !== run.type) {
      this.depots.runs.clore(run.id, 'abandonne', this.horloge());
      return { ignore: true, raison: 'Run périmé : le ticket a changé d’étape.' };
    }
    this.depots.runs.signalerNouvelle(run.id, this.horloge());
    // Le run se clôt dès que le ticket le quitte, avant le démarrage de l'étape suivante (spec puis design).
    const apres = await this.appliquer(avant, evenement, 'systeme', (suivant) => {
      if (suivant.runEnCours !== run.type) this.depots.runs.clore(run.id, suivant.blocage ? 'echoue' : 'termine', suivant.modifieLe);
    });
    // Des commentaires écrits pendant le run attendaient sa fin : l'étape concernée repart.
    const ticket = await this.relancerSiCommentaires(apres);
    return { ignore: false, ticket };
  }

  /**
   * Runs Claude ou pipeline restés sans nouvelles trop longtemps : le ticket passe en Bloqué
   * avec le lien de la session. Il ne repart jamais seul.
   */
  async surveillerSilences(silenceMaxMinutes: number): Promise<number> {
    const limite = new Date(Date.parse(this.horloge()) - silenceMaxMinutes * 60_000).toISOString();
    let bloques = 0;
    for (const run of this.depots.runs.silencieuxDepuis(limite)) {
      const session = run.urlSession ? ` Session : ${run.urlSession}` : '';
      const motif = `La session ne donne plus de nouvelles depuis ${silenceMaxMinutes} minutes.${session}`;
      try {
        const resultat = await this.recevoir(run.id, { type: 'ECHEC', motif });
        if (!resultat.ignore) bloques++;
      } catch {
        // Le ticket a bougé entre temps : le run n'a plus lieu d'être.
        this.depots.runs.clore(run.id, 'abandonne', this.horloge());
      }
    }
    return bloques;
  }

  private async appliquer(avant: Ticket, evenement: Evenement, acteur: Acteur, avantEffets?: (apres: Ticket) => void): Promise<Ticket> {
    const maintenant = this.horloge();
    const preprodOccupeePar = avant.projetId === null ? null : this.depots.tickets.occupantPreprod(avant.projetId, avant.id);
    const resultat = transition(avant, evenement, acteur, { maintenant, preprodOccupeePar });
    if (!resultat.ok) throw new ErreurMetier(409, resultat.code, resultat.message);

    this.depots.tickets.sauver(resultat.ticket, resultat.journal);
    avantEffets?.(resultat.ticket);
    if (evenement.type === 'QUOTA_ATTEINT') this.marquerQuotaEpuise(evenement.repriseEstimee);
    if (evenement.type === 'RELANCER' && avant.blocage?.cause === 'quota') this.marquerQuotaRetabli();
    this.diffuseur.publier({ type: 'ticket', ticket: resultat.ticket });

    let ticket = resultat.ticket;
    for (const effet of resultat.effets) ticket = await this.executer(ticket, effet);
    return ticket;
  }

  private async executer(ticket: Ticket, effet: Effet): Promise<Ticket> {
    const maintenant = this.horloge();
    const run = this.depots.runs.ouvrir(ticket.id, effet.run, maintenant);
    // Préprod et prod passent par le pipeline du projet, le reste par une session Claude.
    const executeur = effet.run === 'preprod' || effet.run === 'deploiement' ? this.executeurs.deploiement : this.executeurs.claude;
    try {
      const projet = ticket.projetId === null ? null : this.depots.projets.lire(ticket.projetId);
      const reponse = await executeur.lancer({ run, ticket, projet });
      // Seul un lancement accepté consomme les commentaires : un échec les laisse en attente pour la relance.
      const transmis = executeur === this.executeurs.claude ? commentairesATransmettre(ticket, effet.run) : [];
      if (transmis.length > 0) {
        this.depots.tickets.marquerCommentairesTransmis(
          ticket.id,
          transmis.map((c) => c.id),
          maintenant,
          { type: 'commentaire', detail: detailJournalTransmission(transmis.length) },
        );
        this.diffuseur.publier({ type: 'ticket', ticket: this.lire(ticket.id) });
      }
      if (reponse.urlSession) {
        this.depots.runs.definirSession(run.id, reponse.urlSession);
        const suivi = executeur === this.executeurs.claude ? `Session Claude démarrée : ${reponse.urlSession}` : `Pipeline lancé, suivi sur ${reponse.urlSession}`;
        this.depots.tickets.journaliser(ticket.id, [{ type: 'action', detail: suivi }], maintenant);
      }
      return this.lire(ticket.id);
    } catch (erreur) {
      this.depots.runs.clore(run.id, 'echoue', this.horloge());
      const evenement: Evenement =
        erreur instanceof QuotaAtteintErreur
          ? { type: 'QUOTA_ATTEINT', repriseEstimee: erreur.repriseEstimee }
          : { type: 'ECHEC', motif: `Le lancement a échoué : ${erreur instanceof Error ? erreur.message : String(erreur)}` };
      const courant = this.lire(ticket.id);
      return this.appliquer(courant, evenement, 'systeme');
    }
  }

  /**
   * En conception, un commentaire sur la spec ou le design relance aussitôt l'étape concernée.
   * C'est la décision de l'utilisatrice, exprimée par son commentaire : la machine à états la valide comme une action.
   */
  private async relancerSiCommentaires(ticket: Ticket): Promise<Ticket> {
    const relance = relanceParCommentaires(ticket);
    return relance ? this.appliquer(ticket, { type: relance }, 'utilisatrice') : ticket;
  }

  private marquerQuotaEpuise(repriseEstimee: string | null): void {
    const quota = this.depots.quota.lire();
    const misAJour = this.depots.quota.ecrire({ pourcentageSemaine: quota.pourcentageSemaine, epuise: true, repriseEstimee: repriseEstimee ?? quota.repriseEstimee }, this.horloge());
    this.diffuseur.publier({ type: 'quota', quota: misAJour });
  }

  private marquerQuotaRetabli(): void {
    const quota = this.depots.quota.lire();
    if (!quota.epuise) return;
    const misAJour = this.depots.quota.ecrire({ ...quota, epuise: false, repriseEstimee: null }, this.horloge());
    this.diffuseur.publier({ type: 'quota', quota: misAJour });
  }

  private lirePourCorrection(id: number): Ticket {
    const ticket = this.lire(id);
    const refus = refusCorrection(ticket);
    if (refus) throw new ErreurMetier(409, refus.code, refus.message);
    return ticket;
  }

  /**
   * Le relais refuse une demande trop grosse pour la tâche cloud. On refuse donc dès l'enregistrement
   * un texte que la session de dev ne pourrait pas recevoir, en gardant de la marge pour le reste de la charge.
   */
  private verifierTailleCharge(
    textes: { spec: string | null; design: string | null; urlMaquette: string | null; commentaires: unknown[] },
    message: string,
  ): void {
    if (JSON.stringify(textes, null, 2).length > TAILLE_MAX_TEXTE - MARGE_CHARGE) {
      throw new ErreurMetier(400, 'TEXTE_TROP_LONG', message);
    }
  }

  private verifierProjet(projetId: number | null): void {
    if (projetId !== null && !this.depots.projets.existe(projetId)) {
      throw new ErreurMetier(400, 'PROJET_INCONNU', 'Ce projet n’existe pas.');
    }
  }
}
