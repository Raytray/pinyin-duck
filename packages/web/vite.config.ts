import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { CHECKOUT_ID_PATH, checkoutId } from '../../scripts/checkout-id.mjs';

/**
 * Answers `CHECKOUT_ID_PATH` with this checkout's id, so the e2e suite can refuse to run
 * against a dev server started from another checkout. Dev server only: a build has no
 * use for it. See `scripts/checkout-id.mjs`.
 */
function checkoutIdentity(): Plugin {
  const id = checkoutId(fileURLToPath(new URL('../..', import.meta.url)));
  return {
    name: 'pinyinduck-checkout-id',
    configureServer(server) {
      server.middlewares.use(CHECKOUT_ID_PATH, (_req, res) => {
        res.setHeader('Content-Type', 'text/plain');
        res.end(id);
      });
    },
  };
}

// https://vitejs.dev/config/
//
// `@pinyinduck/core` needs no alias: its package.json `exports` points at its
// TypeScript source, so Vite and `tsc` both resolve it there.
export default defineConfig({
  plugins: [react(), checkoutIdentity()],
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
