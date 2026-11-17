import { creerApp } from './app';
import { lireConfig } from './config';
import { creerExecuteurs, envoyerParHttp } from './relais/fabrique';

// Charge .env s'il existe. Les secrets restent côté serveur.
try {
  process.loadEnvFile('.env');
} catch {
  // Pas de fichier .env : on garde l'environnement du processus.
}

let config;
try {
  config = lireConfig();
} catch (erreur) {
  console.error(erreur instanceof Error ? erreur.message : erreur);
  process.exit(1);
}

let journaliser: (message: string) => void = console.warn;
const { executeurs, arreter } = creerExecuteurs(config, envoyerParHttp(`http://127.0.0.1:${config.PORT}`, config.WEBHOOK_SECRET), (m) => journaliser(m));
const { serveur } = creerApp({ config, executeurs, journalisation: true });
journaliser = (m) => serveur.log.warn(m);

serveur.addHook('onClose', async () => arreter());

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void serveur.close().then(() => process.exit(0));
  });
}

await serveur.listen({ port: config.PORT, host: '127.0.0.1' });
serveur.log.info(`Spec to prod écoute sur le port ${config.PORT}, mode Claude : ${config.CLAUDE_MODE}`);
