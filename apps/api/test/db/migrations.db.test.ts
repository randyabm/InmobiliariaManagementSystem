import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
const CARPETA_MIGRACIONES = resolveMigrationsFolder(process.cwd());

/**
 * Número de migraciones que Drizzle debe registrar. Se deriva del journal en
 * vez de codificarse a mano: así añadir una migración sin registrarla en
 * `meta/_journal.json` se ve aquí en lugar de pasar inadvertido.
 */
const MIGRACIONES_ESPERADAS = (
  JSON.parse(
    readFileSync(join(CARPETA_MIGRACIONES, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: unknown[] }
).entries.length;

describe('Aplicación real de las migraciones (R10)', () => {
  let contenedor: StartedPostgreSqlContainer;
  let pool: Pool;
  let connectionString: string;

  const carpetaMigraciones = CARPETA_MIGRACIONES;

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

    expect(Number(rows[0]?.total)).toBe(MIGRACIONES_ESPERADAS);
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

    expect(Number(rows[0]?.total)).toBe(MIGRACIONES_ESPERADAS);
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
      "SELECT policyname AS polname FROM pg_policies WHERE tablename = 'tenant' AND schemaname = 'public'",
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
      "SELECT policyname AS polname FROM pg_policies WHERE tablename = 'user_role' AND schemaname = 'public'",
    );

    expect(rows.map((r) => r.polname)).toContain('user_role_tenant_isolation');
  });

  it('la política user_tenant_isolation existe (R1)', async () => {
    const { rows } = await pool.query<{ polname: string }>(
      "SELECT policyname AS polname FROM pg_policies WHERE tablename = 'user' AND schemaname = 'public'",
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
      "SELECT policyname AS polname FROM pg_policies WHERE tablename = 'audit_log' AND schemaname = 'public'",
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

  // ─── Feature #5 owner_tenant_profiles (T8: R1, R5, R6, R7, R37) ───────────

  const TABLAS_CLIENTES = [
    'perfil_propietario',
    'perfil_inquilino',
    'cuenta_bancaria',
  ] as const;

  it.each(TABLAS_CLIENTES)(
    'la tabla %s existe con RLS habilitado Y FORZADO (#5 R5)',
    async (tabla) => {
      const { rows } = await pool.query<{
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(
        `SELECT c.relrowsecurity, c.relforcerowsecurity
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relname = $1`,
        [tabla],
      );

      expect(rows, `la tabla ${tabla} no existe`).toHaveLength(1);
      // ENABLE sin FORCE dejaría al dueño de la tabla fuera del aislamiento
      // (docs/architecture.md: el aislamiento lo fuerza PostgreSQL).
      expect(rows[0]?.relrowsecurity).toBe(true);
      expect(rows[0]?.relforcerowsecurity).toBe(true);
    },
  );

  it.each(TABLAS_CLIENTES)(
    'la política de aislamiento de %s filtra por app.current_tenant (#5 R5)',
    async (tabla) => {
      const { rows } = await pool.query<{ polname: string; qual: string | null }>(
        `SELECT policyname AS polname, qual
           FROM pg_policies WHERE schemaname = 'public' AND tablename = $1`,
        [tabla],
      );

      expect(rows.map((r) => r.polname)).toContain(`${tabla}_tenant_isolation`);
      const politica = rows.find((r) => r.polname === `${tabla}_tenant_isolation`);
      expect(politica?.qual).toContain('app.current_tenant');
    },
  );

  it('user.email y user.password_hash son NULL-able tras D-5 (#5 R6, R7)', async () => {
    const { rows } = await pool.query<{ column_name: string; is_nullable: string }>(
      `SELECT column_name, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'user'
          AND column_name IN ('email', 'password_hash')
        ORDER BY column_name`,
    );

    expect(rows).toEqual([
      { column_name: 'email', is_nullable: 'YES' },
      { column_name: 'password_hash', is_nullable: 'YES' },
    ]);
  });

  it('la UNIQUE de user.email se conserva intacta tras D-5 (#5 R7)', async () => {
    // D-5 relaja el NOT NULL pero NO la unicidad: en PostgreSQL cada NULL es
    // distinto, así que no hace falta índice parcial.
    const { rows } = await pool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'user'`,
    );

    const unicos = rows
      .map((r) => r.indexdef)
      .filter((d) => /CREATE UNIQUE INDEX/i.test(d) && /\(email\)/i.test(d));

    expect(unicos).toHaveLength(1);
    expect(unicos[0]).not.toMatch(/WHERE/i);
  });

  it('perfil_propietario tiene sujeto_retencion y NINGUNA columna de tarifa (#5 R1, D-2)', async () => {
    const { rows } = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'perfil_propietario'`,
    );
    const columnas = rows.map((r) => r.column_name);

    expect(columnas).toContain('sujeto_retencion');

    // D-2: la tarifa la fija la ley y cambia por año; una copia por
    // propietario se desincroniza. Vive en la feature #25, no aquí.
    const tarifas = columnas.filter((c) =>
      /porcentaje|tarifa|retencion_pct|pct_retencion/.test(c),
    );
    expect(
      tarifas,
      `perfil_propietario no puede llevar columna de tarifa (D-2): ${tarifas.join(', ')}`,
    ).toEqual([]);
  });

  it('perfil_propietario y perfil_inquilino tienen las dos UNIQUE de R1/R2 (#5 R1, R2, R9)', async () => {
    const { rows } = await pool.query<{ table_name: string; constraint_name: string }>(
      `SELECT tc.table_name, tc.constraint_name
         FROM information_schema.table_constraints tc
        WHERE tc.table_schema = 'public'
          AND tc.constraint_type = 'UNIQUE'
          AND tc.table_name IN ('perfil_propietario', 'perfil_inquilino')`,
    );
    const nombres = rows.map((r) => r.constraint_name);

    expect(nombres).toContain('perfil_propietario_tenant_user_key');
    expect(nombres).toContain('perfil_propietario_tenant_documento_key');
    expect(nombres).toContain('perfil_inquilino_tenant_user_key');
    expect(nombres).toContain('perfil_inquilino_tenant_documento_key');
  });

  it('0006 deja los triggers append-only de audit_log instalados (#5 R40)', async () => {
    const { rows } = await pool.query<{
      tgname: string;
      tgenabled: string;
      proname: string;
      evento: string;
    }>(
      `SELECT t.tgname,
              t.tgenabled,
              p.proname,
              CASE WHEN (t.tgtype & 16) <> 0 THEN 'update'
                   WHEN (t.tgtype & 8)  <> 0 THEN 'delete'
                   ELSE 'otro' END AS evento
         FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_proc p ON p.oid = t.tgfoid
        WHERE c.relname = 'audit_log' AND NOT t.tgisinternal
        ORDER BY t.tgname`,
    );

    expect(rows.map((fila) => fila.tgname)).toEqual([
      'trg_audit_log_no_delete',
      'trg_audit_log_no_update',
    ]);
    expect(rows.map((fila) => fila.evento)).toEqual(['delete', 'update']);
    // 'O' = habilitado en modo origin. Un trigger deshabilitado no protege.
    expect(rows.map((fila) => fila.tgenabled)).toEqual(['O', 'O']);
    expect(new Set(rows.map((fila) => fila.proname))).toEqual(
      new Set(['audit_log_prevent_mutation']),
    );
  });

  it('UPDATE y DELETE sobre audit_log fallan incluso para el dueño (#5 R41)', async () => {
    const { rows: tenants } = await pool.query<{ id: string }>(
      `INSERT INTO tenant (nombre, nit) VALUES ('Auditada', '900-0006')
       ON CONFLICT (nit) DO UPDATE SET nombre = EXCLUDED.nombre
       RETURNING id`,
    );
    const tenantId = tenants[0]?.id;
    expect(tenantId).toBeDefined();

    const { rows: entradas } = await pool.query<{ id: string }>(
      `INSERT INTO audit_log (tenant_id, accion, entity_type)
       VALUES ($1, 'prueba_inmutabilidad', 'tenant') RETURNING id`,
      [tenantId],
    );
    const entradaId = entradas[0]?.id;

    // `pool` se conecta con el rol dueño de la tabla, que se salta el RLS: si
    // la inmutabilidad dependiera de una política, esto pasaría sin ruido.
    await expect(
      pool.query(`UPDATE audit_log SET accion = 'alterada' WHERE id = $1`, [
        entradaId,
      ]),
    ).rejects.toThrow(/append-only/i);

    await expect(
      pool.query('DELETE FROM audit_log WHERE id = $1', [entradaId]),
    ).rejects.toThrow(/append-only/i);

    const { rows: sigue } = await pool.query<{ accion: string }>(
      'SELECT accion FROM audit_log WHERE id = $1',
      [entradaId],
    );
    expect(sigue[0]?.accion).toBe('prueba_inmutabilidad');
  });

  it('el índice único parcial de cuenta predeterminada existe (#5 R4)', async () => {
    const { rows } = await pool.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'cuenta_bancaria'`,
    );

    const parcial = rows.find(
      (r) => r.indexname === 'cuenta_bancaria_predeterminada_key',
    );
    expect(parcial).toBeDefined();
    expect(parcial?.indexdef).toMatch(/CREATE UNIQUE INDEX/i);
    expect(parcial?.indexdef).toMatch(/WHERE .*es_predeterminada.*activa/is);
  });
});
