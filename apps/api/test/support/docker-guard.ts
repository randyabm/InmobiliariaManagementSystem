import { getContainerRuntimeClient } from 'testcontainers';

export const MENSAJE_SIN_DOCKER =
  'Docker no disponible: los tests de base de datos requieren Testcontainers ' +
  '(PostgreSQL real). Levanta Docker y vuelve a ejecutar `npm run test:db`. ' +
  'Esta suite NO se omite en silencio: un verde sin base de datos sería falso.';

/**
 * Guarda de la suite `test:db` (R19).
 *
 * Si Docker no está disponible la suite FALLA con un motivo explícito, en vez
 * de saltarse y reportar verde. docs/verification.md prohíbe que la ausencia
 * de infraestructura se confunda con "no hay nada que probar": el aislamiento
 * por tenant no se puede dar por bueno sin PostgreSQL real.
 *
 * `probe` se inyecta para poder verificar el camino de error de forma
 * determinista sin apagar el demonio de la máquina.
 */
export async function assertDockerDisponible(
  probe: () => Promise<unknown> = getContainerRuntimeClient,
): Promise<void> {
  try {
    await probe();
  } catch (causa) {
    throw new Error(MENSAJE_SIN_DOCKER, { cause: causa });
  }
}

/** `globalSetup` de `vitest.db.config.ts`. */
export async function setup(): Promise<void> {
  await assertDockerDisponible();
}
