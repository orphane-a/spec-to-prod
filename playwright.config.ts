import { defineConfig } from '@playwright/test';

const PORT = 3100;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // Edge est présent sur Windows : pas de navigateur à télécharger.
    channel: process.env.PW_CHANNEL ?? 'msedge',
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    // Les deux lignes (fonctionnalités et bugs) tiennent à l'écran : un défilement en plein glisser annulerait le geste.
    viewport: { width: 1440, height: 1400 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build && node -e "require(\'fs\').rmSync(\'test-results/e2e.db\',{force:true})" && npx tsx src/serveur/index.ts',
    url: `http://127.0.0.1:${PORT}/api/quota`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PORT: String(PORT),
      BASE_CHEMIN: 'test-results/e2e.db',
      CLAUDE_MODE: 'simule',
      SIMULATION_DELAI_MS: '150',
      MOT_DE_PASSE: 'mot-de-passe-des-tests-e2e',
    },
  },
});
