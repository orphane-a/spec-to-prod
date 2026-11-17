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
const { serveur, service } = creerApp({ config, executeurs, journalisation: true });
journaliser = (m) => serveur.log.warn(m);

// Une session silencieuse (quota épuisé en cours de route, plantage) bloque son ticket au lieu de le laisser tourner.
const surveillance = setInterval(() => {
  service
    .surveillerSilences(config.RUN_SILENCE_MAX_MIN)
    .then((n) => n > 0 && serveur.log.warn(`${n} ticket(s) bloqué(s) faute de nouvelles de leur session.`))
    .catch((e: unknown) => serveur.log.error(e));
}, 60_000);

serveur.addHook('onClose', async () => {
  clearInterval(surveillance);
  arreter();
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void serveur.close().then(() => process.exit(0));
  });
}

await serveur.listen({ port: config.PORT, host: '127.0.0.1' });
serveur.log.info(`Spec to prod écoute sur le port ${config.PORT}, mode Claude : ${config.CLAUDE_MODE}`);
