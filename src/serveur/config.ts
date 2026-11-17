import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { verifierEnvironnement } from './garde-fous';

const URL_FIRE = /^https:\/\/api\.anthropic\.com\/v1\/claude_code\/routines\/trig_[A-Za-z0-9]+\/fire$/;
const ETAPES = ['SPEC', 'DESIGN', 'DEV'] as const;

const urlTache = z.string().regex(URL_FIRE, 'URL attendue : https://api.anthropic.com/v1/claude_code/routines/trig_.../fire').optional();
const jetonTache = z.string().min(20, 'jeton trop court').optional();

const schema = z
  .object({
    PORT: z.coerce.number().int().positive().default(3000),
    BASE_CHEMIN: z.string().default('donnees/spec-to-prod.db'),
    CLAUDE_MODE: z.enum(['simule', 'reel']).default('simule'),
    SIMULATION_DELAI_MS: z.coerce.number().int().nonnegative().default(3000),
    ITERATIONS_MAX: z.coerce.number().int().min(1).max(20).default(5),
    WEBHOOK_SECRET: z.string().min(32, 'WEBHOOK_SECRET doit contenir au moins 32 caractères').optional(),
    /** Minutes sans nouvelles d'un run avant de bloquer le ticket. */
    RUN_SILENCE_MAX_MIN: z.coerce.number().int().min(5).max(24 * 60).default(60),
    RELAIS_URL_PUBLIQUE: z.url({ protocol: /^https$/, error: 'RELAIS_URL_PUBLIQUE doit être une adresse https' }).optional(),
    /** Jeton GitHub à droits fins : Actions en écriture sur les dépôts des projets, rien d'autre. */
    GITHUB_JETON: z.string().min(20, 'jeton trop court').optional(),
    ROUTINE_SPEC_URL: urlTache,
    ROUTINE_SPEC_JETON: jetonTache,
    ROUTINE_DESIGN_URL: urlTache,
    ROUTINE_DESIGN_JETON: jetonTache,
    ROUTINE_DEV_URL: urlTache,
    ROUTINE_DEV_JETON: jetonTache,
    /** Adresse d'écoute : 127.0.0.1 sur un poste, 0.0.0.0 dans le conteneur du VPS. */
    HOST: z.string().default('127.0.0.1'),
    /** Mot de passe unique du tableau. Obligatoire dès que le serveur est joignable de l'extérieur. */
    MOT_DE_PASSE: z.string().min(12, 'MOT_DE_PASSE doit contenir au moins 12 caractères').optional(),
  })
  .superRefine((c, ctx) => {
    const local = ['127.0.0.1', 'localhost', '::1'].includes(c.HOST);
    if (!c.MOT_DE_PASSE && (c.CLAUDE_MODE === 'reel' || !local)) {
      ctx.addIssue({ code: 'custom', path: ['MOT_DE_PASSE'], message: 'MOT_DE_PASSE est obligatoire en mode reel ou hors écoute locale' });
    }
    if (c.CLAUDE_MODE !== 'reel') return;
    const obligatoires = [
      'WEBHOOK_SECRET',
      'RELAIS_URL_PUBLIQUE',
      'GITHUB_JETON',
      ...ETAPES.flatMap((e) => [`ROUTINE_${e}_URL`, `ROUTINE_${e}_JETON`] as const),
    ] as const;
    for (const nom of obligatoires) {
      if (!c[nom]) ctx.addIssue({ code: 'custom', path: [nom], message: `${nom} est obligatoire en mode reel` });
    }
  });

type Brut = z.infer<typeof schema>;
export type Config = Omit<Brut, 'WEBHOOK_SECRET'> & { WEBHOOK_SECRET: string };

export function lireConfig(env: NodeJS.ProcessEnv = process.env): Config {
  verifierEnvironnement(env);
  // Une variable vide dans .env vaut une variable absente.
  const nettoye = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ''));
  const resultat = schema.safeParse(nettoye);
  if (!resultat.success) {
    const details = resultat.error.issues.map((i) => `${i.path.join('.')} : ${i.message}`).join('\n');
    throw new Error(`Configuration invalide :\n${details}`);
  }
  // En mode simulé, le faux Claude vit dans le même processus : un secret éphémère suffit.
  return { ...resultat.data, WEBHOOK_SECRET: resultat.data.WEBHOOK_SECRET ?? randomBytes(32).toString('hex') };
}

/** Tâches cloud de la config, garanties présentes en mode reel par la validation. */
export function tachesCloud(config: Config) {
  const tache = (e: (typeof ETAPES)[number]) => ({ url: config[`ROUTINE_${e}_URL`]!, jeton: config[`ROUTINE_${e}_JETON`]! });
  return { spec: tache('SPEC'), design: tache('DESIGN'), dev: tache('DEV') };
}
