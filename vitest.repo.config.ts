import { defineConfig } from 'vitest/config';

/**
 * Tests estructurales del repositorio: manifiestos, tsconfigs, ESLint,
 * `docker-compose.yml` y registro de migraciones. No dependen de ningún
 * servicio ni de Docker.
 */
export default defineConfig({
  test: {
    name: 'repo',
    root: __dirname,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    testTimeout: 30_000,
  },
});
