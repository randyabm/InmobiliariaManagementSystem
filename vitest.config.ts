import { defineConfig } from 'vitest/config';

/**
 * Suite determinista del monorepo (`npm run test`).
 *
 * INVARIANTE (R19): ninguno de estos proyectos abre un contenedor. Los tests
 * que necesitan PostgreSQL real viven en `apps/api/test/db/` y se ejecutan con
 * `npm run test:db`. Están en otro comando y otro archivo de configuración a
 * propósito: si se "saltaran en silencio" cuando falta Docker, el verde de
 * `npm run test` sería falso.
 *
 * Se usa `test.projects` y no el `vitest.workspace.ts` de design.md §4 porque
 * este último está deprecado en Vitest 3.2 y eliminado en la 4.
 */
export default defineConfig({
  test: {
    projects: [
      './vitest.repo.config.ts',
      './apps/api/vitest.config.ts',
      './apps/web/vitest.config.ts',
    ],
  },
});
