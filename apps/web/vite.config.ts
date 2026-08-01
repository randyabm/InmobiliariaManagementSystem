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
    // El navegador habla SIEMPRE con el mismo origen (feature #28): Vite
    // reenvía /api a la API real. Así la web funciona igual en local y
    // cuando el puerto llega reenviado desde otro equipo/entorno.
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (ruta) => ruta.replace(/^\/api/, ''),
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
