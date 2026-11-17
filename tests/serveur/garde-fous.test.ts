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
  });
});

describe('configuration du mode reel', () => {
  const tache = (e: string) => ({
    [`ROUTINE_${e}_URL`]: `https://api.anthropic.com/v1/claude_code/routines/trig_01${e}/fire`,
    [`ROUTINE_${e}_JETON`]: `sk-ant-oat01-${e.toLowerCase()}-jeton-de-test`,
  });
  const complet = {
    CLAUDE_MODE: 'reel',
    WEBHOOK_SECRET: secret,
    RELAIS_URL_PUBLIQUE: 'https://kanban.orphane.fr',
    ...tache('SPEC'),
    ...tache('DESIGN'),
    ...tache('DEV'),
  };

  it('accepte une configuration complète', () => {
    const config = lireConfig(complet);
    expect(config.CLAUDE_MODE).toBe('reel');
    expect(config.RUN_SILENCE_MAX_MIN).toBe(60);
  });

  it.each(Object.keys(complet).filter((k) => k !== 'CLAUDE_MODE'))('refuse de démarrer sans %s', (nom) => {
    expect(() => lireConfig({ ...complet, [nom]: '' })).toThrow(nom);
  });

  it('refuse une URL de tâche qui ne vise pas /fire', () => {
    expect(() => lireConfig({ ...complet, ROUTINE_DEV_URL: 'https://exemple.fr/fire' })).toThrow('ROUTINE_DEV_URL');
  });

  it('refuse un relais en http', () => {
    expect(() => lireConfig({ ...complet, RELAIS_URL_PUBLIQUE: 'http://kanban.orphane.fr' })).toThrow('RELAIS_URL_PUBLIQUE');
  });

  it('le mode simulé n’exige aucune tâche cloud', () => {
    expect(() => lireConfig({})).not.toThrow();
  });
});
