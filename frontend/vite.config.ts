/// <reference types="vitest" />
import { fileURLToPath } from 'node:url';
import { defineConfig, searchForWorkspaceRoot } from 'vite';
import react from '@vitejs/plugin-react';

// Values shared with the backend (presets, singer labels, limits), imported as @shared/<name>.json
const sharedDir = fileURLToPath(new URL('../backend/assets/shared', import.meta.url));

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@shared': sharedDir },
  },
  server: {
    port: 5173,
    // The dev server serves the shared files from outside frontend/
    fs: { allow: [searchForWorkspaceRoot(process.cwd()), sharedDir] },
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/static': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/tests/setup.ts'],
    css: false,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    testTimeout: 15000,
    minWorkers: 1,
    maxWorkers: 2,
  },
});
