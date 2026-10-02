/// <reference types="vitest" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// `npm run build:pages` builds with --mode pages: assets are served from
// /tracepulse/ on GitHub Pages, and the client switches to the in-browser
// demo data layer instead of calling the Express API.
export default defineConfig(({ mode }) => {
  const isPagesBuild = mode === 'pages';
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react()],
    base: isPagesBuild ? '/tracepulse/' : '/',
    define: {
      'import.meta.env.VITE_DEMO_MODE': JSON.stringify(isPagesBuild ? 'true' : 'false'),
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          // Override with VITE_API_TARGET (env var or client/.env.local) when
          // the server runs on a non-default port.
          target: env.VITE_API_TARGET || 'http://localhost:4000',
          changeOrigin: true,
        },
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
    },
  };
});
