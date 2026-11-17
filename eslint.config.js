import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage', 'playwright-report', 'test-results', 'maquette'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // Le navigateur ne doit jamais toucher au code ni à la configuration du serveur.
      'no-restricted-imports': ['error', { patterns: ['**/serveur/**'] }],
    },
  },
  {
    files: ['src/serveur/**/*.ts', 'tests/**/*.ts', '*.config.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/domaine/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: ['**/serveur/**', '**/web/**', 'node:*'] }] },
  },
);
