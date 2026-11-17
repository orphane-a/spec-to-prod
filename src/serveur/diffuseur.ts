import { EventEmitter } from 'node:events';
import type { Ticket } from '../domaine/types';
import type { Quota } from './base/depots';

export type MessageFlux =
  | { type: 'ticket'; ticket: Ticket }
  | { type: 'ticket_supprime'; id: number }
  | { type: 'quota'; quota: Quota };

/** Diffuse les changements vers les navigateurs connectés au flux SSE. */
export class Diffuseur {
  private readonly emetteur = new EventEmitter().setMaxListeners(100);

  publier(message: MessageFlux): void {
    this.emetteur.emit('message', message);
  }

  abonner(ecouteur: (message: MessageFlux) => void): () => void {
    this.emetteur.on('message', ecouteur);
    return () => this.emetteur.off('message', ecouteur);
  }
}
