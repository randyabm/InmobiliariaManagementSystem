import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';

import { ConfigurationError } from '../common/errors';

let pool: Pool | null = null;

/**
 * Devuelve el pool de PostgreSQL, creándolo la primera vez.
 *
 * INVARIANTE (R14): la conexión es **perezosa**. Importar este módulo, o
 * arrancar la aplicación, no abre ningún socket. Por eso `GET /health`
 * responde 200 sin PostgreSQL levantado.
 *
 * Se usa `pg` con pool explícito (y no un cliente que lo oculte) porque la
 * feature #2 necesita ejecutar `SET LOCAL app.current_tenant` sobre la MISMA
 * conexión de la transacción (D2, design.md §3).
 */
export function getDatabasePool(connectionString: string): Pool {
  if (!connectionString) {
    throw new ConfigurationError(['DATABASE_URL']);
  }
  pool ??= new Pool({ connectionString });
  return pool;
}

/** Cliente Drizzle sobre el pool. */
export function getDatabase(connectionString: string): NodePgDatabase {
  return drizzle(getDatabasePool(connectionString));
}

/**
 * Sirve para demostrar en un test que el arranque de la app no abrió ninguna
 * conexión (R14). Es observación de estado, no lógica de negocio.
 */
export function hasActiveDatabasePool(): boolean {
  return pool !== null;
}

export async function closeDatabasePool(): Promise<void> {
  if (pool === null) return;
  const actual = pool;
  pool = null;
  await actual.end();
}
