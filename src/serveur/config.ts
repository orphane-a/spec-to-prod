import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { verifierEnvironnement } from './garde-fous';

const schema = z
  .object({
    PORT: z.coerce.number().int().positive().default(3000),
    BASE_CHEMIN: z.string().default('donnees/spec-to-prod.db'),
    CLAUDE_MODE: z.enum(['simule', 'reel']).default('simule'),
    SIMULATION_DELAI_MS: z.coerce.number().int().nonnegative().default(3000),
    ITERATIONS_MAX: z.coerce.number().int().min(1).max(20).default(5),
    WEBHOOK_SECRET: z.string().min(32, 'WEBHOOK_SECRET doit contenir au moins 32 caractères').optional(),
  })
  .refine((c) => c.CLAUDE_MODE === 'simule' || c.WEBHOOK_SECRET, {
    message: 'WEBHOOK_SECRET est obligatoire en mode reel',
    path: ['WEBHOOK_SECRET'],
  });

export type Config = Omit<z.infer<typeof schema>, 'WEBHOOK_SECRET'> & { WEBHOOK_SECRET: string };

export function lireConfig(env: NodeJS.ProcessEnv = process.env): Config {
  verifierEnvironnement(env);
  const vide = (v: string | undefined) => (v === '' ? undefined : v);
  const resultat = schema.safeParse({ ...env, WEBHOOK_SECRET: vide(env.WEBHOOK_SECRET) });
  if (!resultat.success) {
    const details = resultat.error.issues.map((i) => `${i.path.join('.')} : ${i.message}`).join('\n');
    throw new Error(`Configuration invalide :\n${details}`);
  }
  // En mode simulé, le faux Claude vit dans le même processus : un secret éphémère suffit.
  return { ...resultat.data, WEBHOOK_SECRET: resultat.data.WEBHOOK_SECRET ?? randomBytes(32).toString('hex') };
}
