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

    expect(Number(rows[0]?.total)).toBe(5);
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

    expect(Number(rows[0]?.total)).toBe(5);
  });

  it('la tabla tenant existe con RLS habilitado (R3)', async () => {
    const { rows: tablas } = await pool.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'tenant'",
    );

    expect(tablas.map((f) => f.tablename)).toContain('tenant');

    const { rows: rls } = await pool.query<{ tablename: string; rowsecurity: boolean }>(
      "SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename = 'tenant'",
    );

    expect(rls[0]?.rowsecurity).toBe(true);
  });

  it('la política tenant_isolation existe (R4)', async () => {
    const { rows } = await pool.query<{ polname: string }>(
      "SELECT polname FROM pg_policies WHERE tablename = 'tenant' AND schemaname = 'public'",
    );

    expect(rows.map((r) => r.polname)).toContain('tenant_isolation');
  });

  it('la tabla user existe con RLS habilitado (R1)', async () => {
    const { rows: tablas } = await pool.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'user'",
    );

    expect(tablas.map((f) => f.tablename)).toContain('user');

    const { rows: rls } = await pool.query<{ tablename: string; rowsecurity: boolean }>(
      "SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename = 'user'",
    );

    expect(rls[0]?.rowsecurity).toBe(true);
  });

  it('la tabla user_role existe con RLS habilitado (R2)', async () => {
    const { rows: tablas } = await pool.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'user_role'",
    );

    expect(tablas.map((f) => f.tablename)).toContain('user_role');

    const { rows: rls } = await pool.query<{ tablename: string; rowsecurity: boolean }>(
      "SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename = 'user_role'",
    );

    expect(rls[0]?.rowsecurity).toBe(true);
  });

  it('la política user_role_tenant_isolation existe (R2)', async () => {
    const { rows } = await pool.query<{ polname: string }>(
      "SELECT polname FROM pg_policies WHERE tablename = 'user_role' AND schemaname = 'public'",
    );

    expect(rows.map((r) => r.polname)).toContain('user_role_tenant_isolation');
  });

  it('la política user_tenant_isolation existe (R1)', async () => {
    const { rows } = await pool.query<{ polname: string }>(
      "SELECT polname FROM pg_policies WHERE tablename = 'user' AND schemaname = 'public'",
    );

    expect(rows.map((r) => r.polname)).toContain('user_tenant_isolation');
  });

  it('la tabla audit_log existe con RLS habilitado (R8)', async () => {
    const { rows: tablas } = await pool.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'audit_log'",
    );

    expect(tablas.map((f) => f.tablename)).toContain('audit_log');

    const { rows: rls } = await pool.query<{ tablename: string; rowsecurity: boolean }>(
      "SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename = 'audit_log'",
    );

    expect(rls[0]?.rowsecurity).toBe(true);
  });

  it('las políticas de audit_log existen (R8)', async () => {
    const { rows } = await pool.query<{ polname: string }>(
      "SELECT polname FROM pg_policies WHERE tablename = 'audit_log' AND schemaname = 'public'",
    );

    const nombres = rows.map((r) => r.polname);
    expect(nombres).toContain('audit_log_tenant_isolation');
    expect(nombres).toContain('audit_log_select_tenant');
  });

  it('el índice audit_log_tenant_created_idx existe (R8)', async () => {
    const { rows } = await pool.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE tablename = 'audit_log' AND schemaname = 'public'",
    );

    expect(rows.map((r) => r.indexname)).toContain('audit_log_tenant_created_idx');
  });
});
