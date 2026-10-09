import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
// A GitHub Pages project site is served from https://<user>.github.io/<repo>/, so every
// emitted asset URL has to carry the repo name as its prefix. BASE_PATH lets the deploy
// workflow pass that in; locally the app is served from the root, so it stays unset.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@pinyinduck/core': path.resolve(__dirname, '../core/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
});
