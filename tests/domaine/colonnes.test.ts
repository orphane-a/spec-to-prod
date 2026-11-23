import { describe, expect, it } from 'vitest';
import { afficheDansTableau } from '../../src/domaine/colonnes';
import { ticket } from './fixtures';

const MAINTENANT = new Date('2026-11-22T12:00:00.000Z');
const ilYa = (jours: number) => new Date(MAINTENANT.getTime() - jours * 24 * 60 * 60 * 1000).toISOString();

describe('affichage de la colonne Done', () => {
  it('affiche un ticket terminé depuis moins de sept jours', () => {
    expect(afficheDansTableau(ticket({ colonne: 'done', deployeLe: ilYa(2) }), MAINTENANT)).toBe(true);
  });

  it('affiche un ticket terminé il y a exactement sept jours', () => {
    expect(afficheDansTableau(ticket({ colonne: 'done', deployeLe: ilYa(7) }), MAINTENANT)).toBe(true);
  });

  it('masque un ticket terminé depuis plus de sept jours', () => {
    expect(afficheDansTableau(ticket({ colonne: 'done', deployeLe: ilYa(8) }), MAINTENANT)).toBe(false);
  });

  it('prend la dernière modification quand la date de déploiement manque', () => {
    expect(afficheDansTableau(ticket({ colonne: 'done', deployeLe: null, modifieLe: ilYa(10) }), MAINTENANT)).toBe(false);
    expect(afficheDansTableau(ticket({ colonne: 'done', deployeLe: null, modifieLe: ilYa(1) }), MAINTENANT)).toBe(true);
  });

  it('affiche toujours les tickets des autres colonnes, même anciens', () => {
    expect(afficheDansTableau(ticket({ colonne: 'test', deployeLe: null, modifieLe: ilYa(30) }), MAINTENANT)).toBe(true);
  });
});
