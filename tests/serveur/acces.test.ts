import { afterEach, describe, expect, it } from 'vitest';
import { creerApp } from '../../src/serveur/app';
import { lireConfig } from '../../src/serveur/config';
import { creerJeton, jetonValide, lireCookie, NOM_COOKIE } from '../../src/serveur/acces';
import { signer } from '../../src/serveur/relais/signature';
import { ExecuteurEspion, SECRET_TEST } from '../api/outils';

const MOT_DE_PASSE = 'un-mot-de-passe-solide';
let instant = Date.parse('2026-11-17T10:00:00.000Z');
let app: ReturnType<typeof creerApp>;

function creer(motDePasse: string | null = MOT_DE_PASSE) {
  instant = Date.parse('2026-11-17T10:00:00.000Z');
  app = creerApp({
    config: { BASE_CHEMIN: ':memory:', ITERATIONS_MAX: 5, WEBHOOK_SECRET: SECRET_TEST, MOT_DE_PASSE: motDePasse ?? undefined },
    executeurs: { claude: new ExecuteurEspion(), deploiement: new ExecuteurEspion() },
    maintenantMs: () => instant,
  });
  return app;
}

afterEach(async () => app?.serveur.close());

const connexion = (motDePasse: string, ip = '10.0.0.1') =>
  app.serveur.inject({ method: 'POST', url: '/api/connexion', payload: { motDePasse }, remoteAddress: ip });

function cookieDe(reponse: { headers: Record<string, unknown> }): string {
  const entete = String(reponse.headers['set-cookie']);
  return entete.split(';')[0]!;
}

describe('accès par mot de passe', () => {
  it('refuse l’API sans session, avec un message en français', async () => {
    creer();
    const r = await app.serveur.inject('/api/tickets');
    expect(r.statusCode).toBe(401);
    expect(r.json()).toEqual({ code: 'NON_CONNECTE', message: 'Connectez vous pour continuer.' });
    expect((await app.serveur.inject('/api/flux')).statusCode).toBe(401);
  });

  it('laisse ouverts la santé et l’état de session', async () => {
    creer();
    expect((await app.serveur.inject('/api/sante')).json()).toMatchObject({ statut: 'ok' });
    expect((await app.serveur.inject('/api/session')).json()).toEqual({ protege: true, connecte: false });
  });

  it('un bon mot de passe ouvre une session par cookie sécurisé', async () => {
    creer();
    const r = await connexion(MOT_DE_PASSE);
    expect(r.statusCode).toBe(204);
    const entete = String(r.headers['set-cookie']);
    expect(entete).toContain('HttpOnly');
    expect(entete).toContain('SameSite=Strict');
    const session = cookieDe(r);
    expect((await app.serveur.inject({ url: '/api/tickets', headers: { cookie: session } })).statusCode).toBe(200);
    expect((await app.serveur.inject({ url: '/api/session', headers: { cookie: session } })).json()).toEqual({ protege: true, connecte: true });
  });

  it('pose Secure derrière le proxy https', async () => {
    creer();
    const r = await app.serveur.inject({ method: 'POST', url: '/api/connexion', payload: { motDePasse: MOT_DE_PASSE }, headers: { 'x-forwarded-proto': 'https' } });
    expect(String(r.headers['set-cookie'])).toContain('Secure');
  });

  it('un mauvais mot de passe est refusé, puis bloqué après cinq essais', async () => {
    creer();
    for (let i = 0; i < 5; i++) {
      const r = await connexion('mauvais');
      expect(r.statusCode).toBe(401);
      expect(r.json().message).toBe('Mot de passe incorrect.');
    }
    expect((await connexion(MOT_DE_PASSE)).statusCode).toBe(429);
    // Une autre adresse n'est pas concernée, et le blocage tombe après un quart d'heure.
    expect((await connexion(MOT_DE_PASSE, '10.0.0.2')).statusCode).toBe(204);
    instant += 16 * 60_000;
    expect((await connexion(MOT_DE_PASSE)).statusCode).toBe(204);
  });

  it('la session expire au bout de trente jours', async () => {
    creer();
    const session = cookieDe(await connexion(MOT_DE_PASSE));
    instant += 31 * 24 * 3600_000;
    expect((await app.serveur.inject({ url: '/api/tickets', headers: { cookie: session } })).statusCode).toBe(401);
  });

  it('un cookie falsifié ne passe pas', async () => {
    creer();
    const faux = `${NOM_COOKIE}=${instant + 1000000}.${'0'.repeat(64)}`;
    expect((await app.serveur.inject({ url: '/api/tickets', headers: { cookie: faux } })).statusCode).toBe(401);
  });

  it('la déconnexion efface le cookie', async () => {
    creer();
    const r = await app.serveur.inject({ method: 'POST', url: '/api/deconnexion' });
    expect(String(r.headers['set-cookie'])).toContain('Max-Age=0');
  });

  it('les webhooks signés passent sans session', async () => {
    creer();
    const brut = JSON.stringify({ runId: 'inconnu', evenement: { type: 'ECHEC', motif: 'x' } });
    const r = await app.serveur.inject({
      method: 'POST',
      url: '/relais/webhooks/claude',
      headers: { 'content-type': 'application/json', 'x-signature': signer(brut, SECRET_TEST) },
      payload: brut,
    });
    expect(r.statusCode).toBe(404);
  });

  it('sans mot de passe, le tableau reste ouvert (usage local)', async () => {
    creer(null);
    expect((await app.serveur.inject('/api/tickets')).statusCode).toBe(200);
    expect((await app.serveur.inject('/api/session')).json()).toEqual({ protege: false, connecte: true });
  });
});

describe('jetons et cookies', () => {
  const cle = Buffer.from('cle-de-test');

  it('valide un jeton signé et non expiré', () => {
    expect(jetonValide(creerJeton(2000, cle), cle, 1000)).toBe(true);
    expect(jetonValide(creerJeton(2000, cle), cle, 3000)).toBe(false);
    expect(jetonValide(creerJeton(2000, Buffer.from('autre')), cle, 1000)).toBe(false);
    expect(jetonValide('n.importe.quoi', cle, 1000)).toBe(false);
    expect(jetonValide(undefined, cle, 1000)).toBe(false);
  });

  it('lit un cookie parmi d’autres', () => {
    expect(lireCookie('a=1; stp_session=abc.def; b=2', 'stp_session')).toBe('abc.def');
    expect(lireCookie(undefined, 'stp_session')).toBe(undefined);
  });
});

describe('configuration du mot de passe', () => {
  it('l’exige dès que le serveur écoute hors de la machine', () => {
    expect(() => lireConfig({ HOST: '0.0.0.0' })).toThrow('MOT_DE_PASSE');
    expect(lireConfig({ HOST: '0.0.0.0', MOT_DE_PASSE: MOT_DE_PASSE }).HOST).toBe('0.0.0.0');
  });

  it('refuse un mot de passe trop court', () => {
    expect(() => lireConfig({ MOT_DE_PASSE: 'court' })).toThrow('12 caractères');
  });

  it('reste facultatif en local et en mode simulé', () => {
    expect(lireConfig({}).MOT_DE_PASSE).toBe(undefined);
  });
});
