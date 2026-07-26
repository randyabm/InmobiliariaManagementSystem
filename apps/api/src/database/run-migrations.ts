import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { ConfigurationError } from '../common/errors';
import {
  defaultMigrationsSearchStart,
  resolveMigrationsFolder,
} from './migrations-folder';

/**
 * Lee la cadena de conexión del entorno.
 *
 * R17: si falta, aborta con un error de dominio que nombra la variable, no
 * con un stack trace crudo del driver `pg` (que además suele imprimir la
 * cadena de conexión completa, secretos incluidos).
 */
export function readDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const valor = env.DATABASE_URL?.trim();
  if (!valor) {
    throw new ConfigurationError(
      ['DATABASE_URL'],
      'Es obligatoria para aplicar las migraciones.',
    );
  }
  return valor;
}

/**
 * Aplica las migraciones pendientes de `apps/api/drizzle/`.
 *
 * Forward-only (docs/conventions.md): no hay archivos `down`; una migración
 * aplicada no se edita nunca. Usa un pool propio y lo cierra al terminar, para
 * que el script no deje el proceso colgado.
 */
export async function runMigrations(
  connectionString: string,
  migrationsFolder = resolveMigrationsFolder(defaultMigrationsSearchStart()),
): Promise<void> {
  const pool = new Pool({ connectionString });
  try {
    await migrate(drizzle(pool), { migrationsFolder });
  } finally {
    await pool.end();
  }
}
