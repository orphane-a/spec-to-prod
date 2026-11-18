import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Config } from './config';
import { ouvrirBase, type Base } from './base/connexion';
import { creerDepots, type Depots } from './base/depots';
import { Diffuseur } from './diffuseur';
import { enregistrerGestionErreurs, enregistrerRoutesApi } from './api/routes';
import { ServiceTickets, horlogeSysteme, type Horloge } from './service-tickets';
import type { Executeurs } from './relais/executeur';
import { enregistrerWebhooks } from './relais/webhooks';
import { enregistrerAcces } from './acces';
import { creerLecteurMaquette, type LecteurMaquette } from './maquette';

export interface OptionsApp {
  config: Pick<Config, 'BASE_CHEMIN' | 'ITERATIONS_MAX' | 'WEBHOOK_SECRET'> & Partial<Pick<Config, 'MOT_DE_PASSE'>>;
  executeurs: Executeurs;
  horloge?: Horloge;
  journalisation?: boolean;
  /** Horloge des sessions, en millisecondes, pour les tests. */
  maintenantMs?: () => number;
  /** Lecture des maquettes sur GitHub. Par défaut sans jeton : dépôts publics et mode simulé. */
  lireMaquette?: LecteurMaquette;
}

export interface App {
  serveur: FastifyInstance;
  base: Base;
  depots: Depots;
  service: ServiceTickets;
  diffuseur: Diffuseur;
}

const DOSSIER_WEB = fileURLToPath(new URL('../../dist/web/', import.meta.url));

export function creerApp(options: OptionsApp): App {
  const base = ouvrirBase(options.config.BASE_CHEMIN);
  const depots = creerDepots(base, options.config.ITERATIONS_MAX);
  const diffuseur = new Diffuseur();
  const horloge = options.horloge ?? horlogeSysteme;
  const service = new ServiceTickets(depots, options.executeurs, diffuseur, horloge);

  // Derrière Traefik sur le VPS : le protocole et l'adresse viennent des en têtes X-Forwarded.
  const serveur = Fastify({ logger: options.journalisation ?? false, bodyLimit: 1_048_576, trustProxy: true });
  enregistrerGestionErreurs(serveur);
  enregistrerAcces(serveur, { motDePasse: options.config.MOT_DE_PASSE, secret: options.config.WEBHOOK_SECRET, maintenant: options.maintenantMs });
  serveur.get('/api/sante', async () => ({ statut: 'ok', version: process.env.SOURCE_COMMIT || 'local' }));
  enregistrerRoutesApi(serveur, service, depots, diffuseur, options.lireMaquette ?? creerLecteurMaquette());
  enregistrerWebhooks(serveur, { secret: options.config.WEBHOOK_SECRET, service, depots, diffuseur, horloge });

  // En prod, le même processus sert l'interface compilée.
  if (existsSync(DOSSIER_WEB)) {
    serveur.register(fastifyStatic, { root: DOSSIER_WEB, wildcard: false });
  }

  serveur.addHook('onClose', async () => base.close());
  return { serveur, base, depots, service, diffuseur };
}
