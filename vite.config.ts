import { defineConfig } from 'vite';

// Base path for GitHub Pages: https://<user>.github.io/calcpad-web/
// Override with VITE_BASE env var if deploying elsewhere.
const base = process.env.VITE_BASE ?? '/calcpad-web/';

export default defineConfig({
  base,
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
  },
  server: {
    port: 4800,
    open: false,
  },
});
