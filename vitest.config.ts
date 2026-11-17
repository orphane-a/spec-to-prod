import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/domaine/**/*.test.ts', 'tests/api/**/*.test.ts', 'tests/relais/**/*.test.ts', 'tests/serveur/**/*.test.ts'],
    environment: 'node',
    env: { CLAUDE_MODE: 'simule', NODE_ENV: 'test' },
  },
});
