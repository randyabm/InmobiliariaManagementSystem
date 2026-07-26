import path from 'node:path';
import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

/**
 * Suite determinista de `apps/api`: NO requiere Docker ni ningún servicio
 * levantado (R19). Los tests que necesitan PostgreSQL real viven en
 * `test/db/` y se ejecutan con `vitest.db.config.ts` (`npm run test:db`).
 *
 * `unplugin-swc` es necesario porque NestJS depende de decoradores y de
 * `emitDecoratorMetadata`, que esbuild (el transformador por defecto de
 * Vitest) no emite.
 */
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  resolve: {
    alias: {
      // El alias del workspace apunta al código fuente: así los tests no
      // dependen de haber compilado `packages/types` antes (R4).
      '@inmobiliaria/types': path.resolve(
        __dirname,
        '../../packages/types/src/index.ts',
      ),
    },
  },
  test: {
    name: 'api',
    root: __dirname,
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/unit/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'dist/**', 'test/db/**'],
  },
});
