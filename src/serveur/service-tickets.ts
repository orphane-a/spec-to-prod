import { estModifiable, transition } from '../domaine/machine-etats';
import type { Acteur, Effet, Evenement, Ticket } from '../domaine/types';
import type { Depots, SaisieTicket } from './base/depots';
import type { Diffuseur } from './diffuseur';
import { ErreurMetier, introuvable } from './erreurs';
import { QuotaAtteintErreur, type Executeurs } from './relais/executeur';

export type Horloge = () => string;
export const horlogeSysteme: Horloge = () => new Date().toISOString();

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
    this.depots.tickets.journaliser(ticket.id, [{ type: 'action', detail: 'Ticket ajouté au backlog.' }], maintenant);
    this.diffuseur.publier({ type: 'ticket', ticket });
    return ticket;
  }

  modifier(id: number, saisie: SaisieTicket): Ticket {
    const ticket = this.lire(id);
    if (!estModifiable(ticket)) throw new ErreurMetier(409, 'NON_MODIFIABLE', 'Seuls les tickets du backlog se modifient.');
    this.verifierProjet(saisie.projetId);
    const maintenant = this.horloge();
    const modifie = this.depots.tickets.modifier(id, saisie, maintenant)!;
    this.depots.tickets.journaliser(id, [{ type: 'action', detail: 'Ticket modifié.' }], maintenant);
    this.diffuseur.publier({ type: 'ticket', ticket: modifie });
    return modifie;
  }

  supprimer(id: number): void {
    const ticket = this.lire(id);
    if (!estModifiable(ticket)) throw new ErreurMetier(409, 'NON_MODIFIABLE', 'Seuls les tickets du backlog se suppriment.');
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
    const ticket = await this.appliquer(avant, evenement, 'systeme', (apres) => {
      if (apres.runEnCours !== run.type) this.depots.runs.clore(run.id, apres.blocage ? 'echoue' : 'termine', apres.modifieLe);
    });
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
      if (reponse.urlSession) {
        this.depots.runs.definirSession(run.id, reponse.urlSession);
        this.depots.tickets.journaliser(ticket.id, [{ type: 'action', detail: `Session démarrée : ${reponse.urlSession}` }], maintenant);
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

  private verifierProjet(projetId: number | null): void {
    if (projetId !== null && !this.depots.projets.existe(projetId)) {
      throw new ErreurMetier(400, 'PROJET_INCONNU', 'Ce projet n’existe pas.');
    }
  }
}
