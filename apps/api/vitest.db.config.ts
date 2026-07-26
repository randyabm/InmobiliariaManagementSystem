import path from 'node:path';
import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

/**
 * Suite de base de datos REAL (`npm run test:db`).
 *
 * Levanta PostgreSQL con Testcontainers: nada de mocks ni SQLite
 * (docs/verification.md Nivel 2, CHECKPOINTS.md §C4). Vive en un archivo de
 * configuración aparte para que `npm run test` —el que ejecuta `init.sh`— no
 * pueda arrastrar dependencias de contenedores.
 */
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  resolve: {
    alias: {
      '@inmobiliaria/types': path.resolve(
        __dirname,
        '../../packages/types/src/index.ts',
      ),
    },
  },
  test: {
    name: 'api-db',
    root: __dirname,
    environment: 'node',
    include: ['test/db/**/*.test.ts'],
    globalSetup: ['./test/support/docker-guard.ts'],
    // Descargar una imagen y arrancar el contenedor puede tardar.
    testTimeout: 180_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
