import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Alias del workspace hacia el código fuente del paquete compartido
      // (R4): ningún import relativo cruza la frontera de paquetes.
      '@inmobiliaria/types': path.resolve(
        __dirname,
        '../../packages/types/src/index.ts',
      ),
    },
  },
  server: {
    port: 5173,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
