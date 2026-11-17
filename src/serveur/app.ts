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

export interface OptionsApp {
  config: Pick<Config, 'BASE_CHEMIN' | 'ITERATIONS_MAX' | 'WEBHOOK_SECRET'>;
  executeurs: Executeurs;
  horloge?: Horloge;
  journalisation?: boolean;
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

  const serveur = Fastify({ logger: options.journalisation ?? false, bodyLimit: 1_048_576 });
  enregistrerGestionErreurs(serveur);
  enregistrerRoutesApi(serveur, service, depots, diffuseur);
  enregistrerWebhooks(serveur, { secret: options.config.WEBHOOK_SECRET, service, depots, diffuseur, horloge });

  // En prod, le même processus sert l'interface compilée.
  if (existsSync(DOSSIER_WEB)) {
    serveur.register(fastifyStatic, { root: DOSSIER_WEB, wildcard: false });
  }

  serveur.addHook('onClose', async () => base.close());
  return { serveur, base, depots, service, diffuseur };
}
