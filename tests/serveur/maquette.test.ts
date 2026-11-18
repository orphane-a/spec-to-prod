import { describe, expect, it } from 'vitest';
import { ErreurMaquette, creerLecteurMaquette, emplacementMaquette } from '../../src/serveur/maquette';
import { creerAppTest, creerTicket } from '../api/outils';
import { URL_MAQUETTE, ticket } from '../domaine/fixtures';

const BRANCHE = 'claude/12-fiche-personnage';
const avecMaquette = ticket({ id: 12, colonne: 'conception', branche: BRANCHE, design: '# D', urlMaquette: URL_MAQUETTE, designVersion: 1 });

function lecteur(reponse: () => Response | Promise<Response>, jeton?: string) {
  const appels: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    appels.push({ url, init });
    return reponse();
  }) as unknown as typeof fetch;
  return { lire: creerLecteurMaquette({ jeton, fetch: f }), appels };
}

async function erreurDe(promesse: Promise<unknown>): Promise<Error> {
  try {
    await promesse;
  } catch (e) {
    return e as Error;
  }
  throw new Error('aucune erreur levée');
}

describe('emplacement de la maquette sur GitHub', () => {
  it('reconnaît une branche avec des barres obliques grâce à la branche du ticket', () => {
    expect(emplacementMaquette(URL_MAQUETTE, BRANCHE)).toEqual({ depot: 'orphane-a/optivie', branche: BRANCHE, chemin: 'maquettes/ticket-12.html' });
  });

  it('prend le premier segment comme branche sans branche connue', () => {
    expect(emplacementMaquette('https://github.com/o/r/blob/main/maquettes/m.html', null)).toEqual({ depot: 'o/r', branche: 'main', chemin: 'maquettes/m.html' });
  });

  it('refuse les liens qui ne sont pas des fichiers GitHub', () => {
    for (const url of ['https://exemple.fr/o/r/blob/b/m.html', 'http://github.com/o/r/blob/b/m.html', 'https://github.com/o/r/tree/b/m', 'https://github.com/o/r/blob/b', 'https://github.com/o/r/blob/b/../secret', 'pas une url']) {
      expect(emplacementMaquette(url, null)).toBe(null);
    }
  });
});

describe('lecture de la maquette', () => {
  it('lit le fichier brut via l’API GitHub, avec le jeton côté serveur', async () => {
    const { lire, appels } = lecteur(() => new Response('<h1>Maquette</h1>'), 'github_pat_jeton_de_test');
    expect(await lire(avecMaquette)).toBe('<h1>Maquette</h1>');
    expect(appels[0]!.url).toBe('https://api.github.com/repos/orphane-a/optivie/contents/maquettes/ticket-12.html?ref=claude%2F12-fiche-personnage');
    const entetes = appels[0]!.init.headers as Record<string, string>;
    expect(entetes.Authorization).toBe('Bearer github_pat_jeton_de_test');
    expect(entetes.Accept).toBe('application/vnd.github.raw+json');
  });

  it('se passe de jeton pour un dépôt public', async () => {
    const { lire, appels } = lecteur(() => new Response('<p>ok</p>'));
    await lire(avecMaquette);
    expect((appels[0]!.init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('explique en français un fichier introuvable ou un jeton sans droit', async () => {
    expect((await erreurDe(lecteur(() => new Response(null, { status: 404 })).lire(avecMaquette))).message).toMatch(/Maquette introuvable : maquettes\/ticket-12\.html/);
    const refus = await erreurDe(lecteur(() => new Response(null, { status: 403 })).lire(avecMaquette));
    expect(refus).toBeInstanceOf(ErreurMaquette);
    expect(refus.message).toMatch(/Contents en lecture/);
  });

  it('signale GitHub injoignable', async () => {
    const e = await erreurDe(lecteur(() => Promise.reject(new Error('réseau'))).lire(avecMaquette));
    expect(e.message).toMatch(/injoignable/);
  });

  it('fabrique une maquette de démonstration en mode simulé, sans appel réseau', async () => {
    const { lire, appels } = lecteur(() => new Response('jamais'));
    const html = await lire({ ...avecMaquette, titre: 'Fiche <perso>', urlMaquette: 'https://maquette.exemple.test/b/ticket-12.html' });
    expect(appels).toHaveLength(0);
    expect(html).toContain('Fiche &#60;perso&#62;');
  });

  it('refuse un ticket sans maquette', async () => {
    const e = await erreurDe(lecteur(() => new Response('')).lire({ ...avecMaquette, urlMaquette: null }));
    expect(e.message).toBe('Ce ticket n’a pas encore de maquette.');
  });
});

describe('route de la maquette', () => {
  it('sert la maquette isolée du tableau, sans accès réseau', async () => {
    const app = creerAppTest();
    const { id } = await creerTicket(app);
    const r = await app.serveur.inject({ method: 'GET', url: `/api/tickets/${id}/maquette` });
    // Pas encore de maquette : page d'explication, dans le même bac à sable.
    expect(r.statusCode).toBe(502);
    expect(r.headers['content-type']).toBe('text/html; charset=utf-8');
    const politique = String(r.headers['content-security-policy']);
    expect(politique).toContain('sandbox allow-scripts');
    expect(politique).toContain("default-src 'none'");
    expect(politique).not.toContain('allow-same-origin');
    expect(r.body).toContain('Ce ticket n’a pas encore de maquette.');
    await app.serveur.close();
  });

  it('répond 404 pour un ticket inconnu', async () => {
    const app = creerAppTest();
    const r = await app.serveur.inject({ method: 'GET', url: '/api/tickets/999/maquette' });
    expect(r.statusCode).toBe(404);
    await app.serveur.close();
  });
});
