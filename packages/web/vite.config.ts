import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
//
// `@pinyinduck/core` needs no alias: its package.json `exports` points at its
// TypeScript source, so Vite and `tsc` both resolve it there.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
  },
});
