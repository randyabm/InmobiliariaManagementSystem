import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { ConfigurationError } from '../common/errors';
import {
  defaultMigrationsSearchStart,
  resolveMigrationsFolder,
} from './migrations-folder';

/**
 * Lee la cadena de conexión **del rol privilegiado** (R47, D-10).
 *
 * Migrar exige ser dueño del esquema; servir exige justo lo contrario (un rol
 * sin `BYPASSRLS`, R43). Por eso son dos variables distintas y esta función
 * lee `DATABASE_MIGRATION_URL`, no `DATABASE_URL`: si leyera la de la
 * aplicación, o las migraciones fallarían por falta de privilegios, o —peor—
 * alguien "arreglaría" el problema devolviendo el superusuario a la API y
 * dejando el RLS inerte otra vez, que es el hallazgo B3.
 *
 * R17: si falta, aborta con un error de dominio que nombra la variable, no
 * con un stack trace crudo del driver `pg` (que además suele imprimir la
 * cadena de conexión completa, secretos incluidos).
 */
export function readDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const valor = env.DATABASE_MIGRATION_URL?.trim();
  if (!valor) {
    throw new ConfigurationError(
      ['DATABASE_MIGRATION_URL'],
      'Es la cadena del rol privilegiado y es obligatoria para aplicar las migraciones. No uses DATABASE_URL: esa es la del rol de aplicacion, que no puede modificar el esquema (R43, R47).',
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
