import { z } from 'zod';
import { verifierEnvironnement } from './garde-fous';

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  BASE_CHEMIN: z.string().default('donnees/spec-to-prod.db'),
  CLAUDE_MODE: z.enum(['simule', 'reel']).default('simule'),
  SIMULATION_DELAI_MS: z.coerce.number().int().nonnegative().default(3000),
  ITERATIONS_MAX: z.coerce.number().int().min(1).max(20).default(5),
  WEBHOOK_SECRET: z.string().min(32, 'WEBHOOK_SECRET doit contenir au moins 32 caractères'),
  URL_PUBLIQUE: z.string().url().default('http://localhost:3000'),
});

export type Config = z.infer<typeof schema>;

export function lireConfig(env: NodeJS.ProcessEnv = process.env): Config {
  verifierEnvironnement(env);
  const resultat = schema.safeParse(env);
  if (!resultat.success) {
    const details = resultat.error.issues.map((i) => `${i.path.join('.')} : ${i.message}`).join('\n');
    throw new Error(`Configuration invalide :\n${details}`);
  }
  return resultat.data;
}
