import type { ControlesDev, Evenement, Ticket } from '../../domaine/types';
import { QuotaAtteintErreur, type DemandeRun, type Executeur, type ReponseLancement } from './executeur';
import { SOURCES } from './webhooks';

/**
 * Mode simulé : un faux Claude et un faux pipeline qui répondent après quelques secondes
 * en appelant les vrais webhooks signés du relais. Aucun quota n'est consommé.
 *
 * Mots clés reconnus dans la description d'un ticket, valables une seule fois
 * pour que le bouton Relancer montre la reprise :
 *   #simu:echec-spec          la rédaction de spec échoue
 *   #simu:echec-design        la conception de la maquette échoue
 *   #simu:iterations          la boucle de dev atteint le maximum d'itérations
 *   #simu:quota               le lancement est refusé pour quota atteint
 *   #simu:echec-deploiement   le déploiement échoue à l'envoi sur le serveur
 */

export type Envoyer = (chemin: string, corps: object) => Promise<void>;

export interface OptionsSimulation {
  delaiMs: number;
  envoyer: Envoyer;
  journaliser?: (message: string) => void;
}

type Etape = { apres: number; corps: Evenement; quota?: number };

type MotCle = 'echec-spec' | 'echec-design' | 'iterations' | 'quota' | 'echec-deploiement';

export class Simulation {
  private readonly minuteries = new Set<NodeJS.Timeout>();
  private readonly dejaJoues = new Set<string>();
  private pourcentageQuota = 12;

  constructor(private readonly options: OptionsSimulation) {}

  readonly claude: Executeur = {
    lancer: async ({ run, ticket }: DemandeRun): Promise<ReponseLancement> => {
      if (this.consommer(ticket, 'quota')) {
        throw new QuotaAtteintErreur(new Date(Date.now() + 2 * 3600_000).toISOString());
      }
      const etapes = run.type === 'spec' ? this.etapesSpec(ticket) : run.type === 'design' ? this.etapesDesign(ticket) : this.etapesDev(ticket);
      this.programmer(SOURCES.claude.chemin, run.id, etapes);
      return { urlSession: `simulation:${run.id.slice(0, 8)}` };
    },
  };

  readonly deploiement: Executeur = {
    lancer: async ({ run, ticket }: DemandeRun): Promise<ReponseLancement> => {
      this.programmer(SOURCES.pipeline.chemin, run.id, this.etapesDeploiement(ticket));
      return {};
    },
  };

  /** Annule les réponses en attente, à l'arrêt du serveur ou en fin de test. */
  arreter(): void {
    for (const m of this.minuteries) clearTimeout(m);
    this.minuteries.clear();
  }

  private consommer(ticket: Ticket, mot: MotCle): boolean {
    const cle = `${ticket.id}:${mot}`;
    if (!ticket.description.includes(`#simu:${mot}`) || this.dejaJoues.has(cle)) return false;
    this.dejaJoues.add(cle);
    return true;
  }

  private programmer(chemin: string, runId: string, etapes: Etape[]): void {
    let cumul = 0;
    for (const etape of etapes) {
      cumul += etape.apres;
      const minuterie = setTimeout(() => {
        this.minuteries.delete(minuterie);
        const corps = { runId, evenement: etape.corps, ...(etape.quota !== undefined ? { quota: { pourcentageSemaine: etape.quota } } : {}) };
        this.options.envoyer(chemin, corps).catch((e: unknown) => {
          this.options.journaliser?.(`Simulation : envoi refusé (${e instanceof Error ? e.message : String(e)})`);
        });
      }, cumul);
      this.minuteries.add(minuterie);
    }
  }

  private quotaSuivant(consommation: number): number {
    this.pourcentageQuota = Math.min(99, this.pourcentageQuota + consommation);
    return this.pourcentageQuota;
  }

  private etapesSpec(ticket: Ticket): Etape[] {
    const d = this.options.delaiMs;
    if (this.consommer(ticket, 'echec-spec')) {
      return [{ apres: d, corps: { type: 'ECHEC', motif: 'La rédaction de la spec a échoué (simulation).' } }];
    }
    return [{ apres: d, corps: { type: 'SPEC_PRETE', spec: specSimulee(ticket) }, quota: this.quotaSuivant(2) }];
  }

  private etapesDesign(ticket: Ticket): Etape[] {
    const d = this.options.delaiMs;
    if (this.consommer(ticket, 'echec-design')) {
      return [{ apres: d, corps: { type: 'ECHEC', motif: 'La conception de la maquette a échoué (simulation).' } }];
    }
    const branche = (ticket.branche ?? `claude/${ticket.id}`).replace('claude/', '');
    return [
      {
        apres: d,
        corps: { type: 'DESIGN_PRET', resume: designSimule(ticket), urlMaquette: `https://maquette.exemple.test/${branche}/ticket-${ticket.id}.html` },
        quota: this.quotaSuivant(2),
      },
    ];
  }

  private etapesDev(ticket: Ticket): Etape[] {
    const d = this.options.delaiMs;
    if (this.consommer(ticket, 'iterations')) {
      const enEchec: ControlesDev = { unitaires: 'vert', non_regression: 'rouge', exploratoire: 'rouge' };
      return Array.from({ length: ticket.iterationMax }, (_, i) => ({
        apres: d,
        corps: { type: 'ITERATION_TERMINEE', iteration: i + 1, controles: enEchec },
        quota: this.quotaSuivant(1),
      }));
    }
    const iterations: ControlesDev[] = [
      { unitaires: 'vert', non_regression: 'rouge', exploratoire: 'en_attente' },
      { unitaires: 'vert', non_regression: 'vert', exploratoire: 'rouge' },
      { unitaires: 'vert', non_regression: 'vert', exploratoire: 'vert' },
    ];
    const branche = ticket.branche ?? `claude/${ticket.id}`;
    return [
      ...iterations.map((controles, i) => ({
        apres: d,
        corps: { type: 'ITERATION_TERMINEE', iteration: i + 1, controles } satisfies Evenement,
        quota: this.quotaSuivant(1),
      })),
      {
        apres: d,
        corps: {
          type: 'DEV_TERMINE',
          urlPreprod: `https://preprod.exemple.test/${branche.replace('claude/', '')}`,
          controles: iterations.at(-1)!,
          scenarios: scenariosSimules(ticket),
        },
      },
    ];
  }

  private etapesDeploiement(ticket: Ticket): Etape[] {
    const d = this.options.delaiMs;
    const etapes: Etape[] = [
      { apres: d, corps: { type: 'ETAPE_DEPLOIEMENT', etapes: { fusion: 'vert', envoi: 'en_cours', verification: 'en_attente' } } },
    ];
    if (this.consommer(ticket, 'echec-deploiement')) {
      return [...etapes, { apres: d, corps: { type: 'ECHEC', motif: 'Le serveur de production ne répond pas (simulation).' } }];
    }
    return [
      ...etapes,
      { apres: d, corps: { type: 'ETAPE_DEPLOIEMENT', etapes: { fusion: 'vert', envoi: 'vert', verification: 'en_cours' } } },
      { apres: d, corps: { type: 'DEPLOIEMENT_TERMINE', version: `v1.0.${ticket.id}` } },
    ];
  }
}

function specSimulee(ticket: Ticket): string {
  return [
    `# ${ticket.titre}`,
    '',
    '_Spec rédigée par le faux Claude du mode simulé._',
    '',
    '## Contexte',
    '',
    ticket.description.replace(/#simu:[a-z-]+/g, '').trim() || 'Aucune description fournie.',
    '',
    '## Exigences indispensables',
    '',
    '1. Le parcours principal fonctionne de bout en bout.',
    '2. Les erreurs de saisie affichent un message clair en français.',
    '3. L’interface reste utilisable sur téléphone.',
    '',
    '## Critères d’acceptation',
    '',
    '- Étant donné une saisie valide, quand je valide, alors le résultat s’affiche.',
    '- Étant donné une saisie vide, quand je valide, alors un message explique quoi corriger.',
  ].join('\n');
}

function designSimule(ticket: Ticket): string {
  return [
    `# Design : ${ticket.titre}`,
    '',
    '_Maquette conçue par le faux Claude du mode simulé._',
    '',
    '## Écrans',
    '',
    '1. Écran principal avec le formulaire et le résultat.',
    '2. État d’erreur avec un message sous le champ concerné.',
    '',
    '## Textes',
    '',
    '- Bouton principal : Valider',
    '- Message d’erreur : Ce champ est obligatoire.',
  ].join('\n');
}

function scenariosSimules(ticket: Ticket) {
  return [
    { objectif: 'Cas nominal', etapes: `Ouvrir la préprod et utiliser « ${ticket.titre} » avec des données valides.`, resultatAttendu: 'Le résultat attendu s’affiche sans erreur.' },
    { objectif: 'Cas d’erreur', etapes: 'Valider le formulaire avec un champ obligatoire vide.', resultatAttendu: 'Un message clair indique le champ à corriger.' },
    { objectif: 'Affichage sur téléphone', etapes: 'Refaire le cas nominal sur un téléphone.', resultatAttendu: 'Tout reste lisible et utilisable.' },
  ];
}
