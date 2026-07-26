import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resolveMigrationsFolder } from '../../src/database/migrations-folder';
import { runMigrations } from '../../src/database/run-migrations';

/**
 * Aplica la migración inicial contra PostgreSQL REAL (R10, CHECKPOINTS §C4).
 *
 * `design.md` §10 había diferido este test a la feature #2 por ausencia de
 * Docker en la máquina. Docker ya está disponible, así que la deuda se cierra
 * aquí: toda migración del repositorio tiene un test que la ejercita de verdad.
 */
describe('Aplicación real de las migraciones (R10)', () => {
  let contenedor: StartedPostgreSqlContainer;
  let pool: Pool;
  let connectionString: string;

  const carpetaMigraciones = resolveMigrationsFolder(process.cwd());

  beforeAll(async () => {
    contenedor = await new PostgreSqlContainer('postgres:16.4-alpine').start();
    connectionString = contenedor.getConnectionUri();
    pool = new Pool({ connectionString });
  });

  afterAll(async () => {
    await pool?.end();
    await contenedor?.stop();
  });

  it('aplica la migración inicial y registra su ejecución', async () => {
    await runMigrations(connectionString, carpetaMigraciones);

    const { rows } = await pool.query<{ total: string }>(
      'SELECT count(*)::text AS total FROM drizzle.__drizzle_migrations',
    );

    expect(Number(rows[0]?.total)).toBe(1);
  });

  it('deja disponibles las extensiones que declara', async () => {
    const { rows } = await pool.query<{ extname: string }>(
      "SELECT extname FROM pg_extension WHERE extname IN ('pgcrypto', 'citext')",
    );

    expect(rows.map((fila) => fila.extname).sort()).toEqual([
      'citext',
      'pgcrypto',
    ]);
  });

  it('gen_random_uuid() funciona tras la migración', async () => {
    const { rows } = await pool.query<{ id: string }>(
      'SELECT gen_random_uuid()::text AS id',
    );

    expect(rows[0]?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('es idempotente: re-aplicarla no duplica ni falla', async () => {
    await runMigrations(connectionString, carpetaMigraciones);

    const { rows } = await pool.query<{ total: string }>(
      'SELECT count(*)::text AS total FROM drizzle.__drizzle_migrations',
    );

    expect(Number(rows[0]?.total)).toBe(1);
  });

  it('NO crea ninguna tabla de negocio en el esquema public (R11)', async () => {
    // Comprobación contra el motor, no contra el texto del SQL: si alguien
    // creara una tabla sin RLS antes de la feature #2, aparecería aquí.
    const { rows } = await pool.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
    );

    expect(rows.map((fila) => fila.tablename)).toEqual([]);
  });
});
