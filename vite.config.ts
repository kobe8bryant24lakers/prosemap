import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: resolve(projectRoot, 'desktop'),
  // Native builds and browser acceptance can run independently without
  // invalidating each other's optimized dependency URLs.
  cacheDir: resolve(projectRoot, process.env.PROSEMAP_VITE_CACHE_DIR || 'node_modules/.vite'),
  base: './',
  clearScreen: false,
  plugins: [react()],
  resolve: { alias: { '@': projectRoot } },
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
    fs: { allow: [projectRoot] },
  },
  build: {
    outDir: resolve(projectRoot, 'dist'),
    emptyOutDir: true,
    target: ['chrome105', 'safari13'],
  },
});
