import { describe, expect, it } from 'vitest';
import { ConfigurationInterditeErreur, verifierEnvironnement } from '../../src/serveur/garde-fous';
import { lireConfig } from '../../src/serveur/config';

const secret = 'x'.repeat(32);

describe('garde fou ANTHROPIC_API_KEY', () => {
  it('refuse un environnement qui définit ANTHROPIC_API_KEY', () => {
    expect(() => verifierEnvironnement({ ANTHROPIC_API_KEY: 'sk-test' })).toThrow(ConfigurationInterditeErreur);
  });

  it('refuse même une valeur vide', () => {
    expect(() => verifierEnvironnement({ ANTHROPIC_API_KEY: '' })).toThrow(ConfigurationInterditeErreur);
  });

  it('accepte un environnement sans la variable', () => {
    expect(() => verifierEnvironnement({ PATH: '/usr/bin' })).not.toThrow();
  });

  it('lireConfig applique le garde fou avant tout', () => {
    expect(() => lireConfig({ ANTHROPIC_API_KEY: 'sk', WEBHOOK_SECRET: secret })).toThrow(ConfigurationInterditeErreur);
  });
});

describe('lecture de la configuration', () => {
  it('utilise le mode simulé par défaut', () => {
    const config = lireConfig({ WEBHOOK_SECRET: secret });
    expect(config.CLAUDE_MODE).toBe('simule');
    expect(config.ITERATIONS_MAX).toBe(5);
  });

  it('exige un secret de webhook assez long', () => {
    expect(() => lireConfig({ WEBHOOK_SECRET: 'court' })).toThrow(/WEBHOOK_SECRET/);
  });

  it('génère un secret éphémère en mode simulé', () => {
    expect(lireConfig({}).WEBHOOK_SECRET.length).toBeGreaterThanOrEqual(32);
  });

  it('exige un secret en mode réel', () => {
    expect(() => lireConfig({ CLAUDE_MODE: 'reel' })).toThrow(/WEBHOOK_SECRET/);
    expect(lireConfig({ CLAUDE_MODE: 'reel', WEBHOOK_SECRET: secret }).WEBHOOK_SECRET).toBe(secret);
  });
});
