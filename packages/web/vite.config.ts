import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
//
// `@pinyinduck/core` needs no alias: its package.json `exports` points at its
// TypeScript source, so Vite and `tsc` both resolve it there.
export default defineConfig({
  plugins: [react()],
  // GitHub Pages serves the site under /<repo>/; deploy-pages.yml sets BASE_PATH to that.
  base: process.env.BASE_PATH ?? '/',
  build: {
    // `public/` holds only the uncompressed `dictionary.btree`, which Rime, the Android
    // build and the parity generator read from there. The app downloads the gzipped,
    // content-hashed copy it imports from `src/generated/`, so the raw 9MB file stays
    // out of the build.
    copyPublicDir: false,
  },
  server: {
    port: 5173,
    host: true,
  },
});
