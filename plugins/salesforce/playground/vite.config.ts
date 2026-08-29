import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const playgroundRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: playgroundRoot,
  base: '/plugins/salesforce/assets/playground/dist/',
  plugins: [react()],
  worker: { format: 'es' },
  optimizeDeps: {
    include: ['monaco-editor']
  },
  build: {
    outDir: resolve(playgroundRoot, 'dist'),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('monaco-editor')) return 'monaco';
        }
      }
    }
  },
  resolve: {
    dedupe: ['monaco-editor', 'react', 'react-dom']
  }
});
