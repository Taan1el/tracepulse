/// <reference types="vitest" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { localFirstBuild } from './localBuild.js';

// `npm run build:pages` builds with --mode pages: assets are served from
// /tracepulse/ on GitHub Pages, and the client switches to the in-browser
// workspace and sample data layer instead of calling the Express API.
export default defineConfig(({ mode }) => {
  const isPagesBuild = mode === 'pages';
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react(), ...(isPagesBuild ? [localFirstBuild({
      base: '/tracepulse/',
      id: 'tracepulse',
      name: 'TracePulse',
      description: 'A trace viewer for files stored in this browser.',
    })] : [])],
    base: isPagesBuild ? '/tracepulse/' : '/',
    build: { assetsInlineLimit: isPagesBuild ? 0 : undefined },
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
