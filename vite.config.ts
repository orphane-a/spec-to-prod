import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const portServeur = Number(process.env.PORT ?? 3000);

export default defineConfig({
  root: 'src/web',
  plugins: [react()],
  // Seules les variables préfixées VITE_ arrivent dans le navigateur : aucun secret n'en porte.
  envPrefix: 'VITE_',
  build: { outDir: '../../dist/web', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      // Barre oblique finale : sans elle, le fichier /api.ts de l'interface partirait vers le serveur.
      '/api/': { target: `http://localhost:${portServeur}`, changeOrigin: false },
    },
  },
});
