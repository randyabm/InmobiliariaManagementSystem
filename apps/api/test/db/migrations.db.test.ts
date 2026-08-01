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

  it('la unicidad del correo pasa de global a POR TENANT (#5 R7, R59, D-8)', async () => {
    // D-5 relajó el NOT NULL pero no la unicidad. **D-8** sí la cambia: dos
    // personas distintas con el mismo correo, cada una en su inmobiliaria, son
    // dos identidades legítimas. Los NULL siguen conviviendo sin índice
    // parcial, porque PostgreSQL trata cada NULL como distinto (R7).
    const { rows } = await pool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'user'`,
    );
    const unicos = rows
      .map((r) => r.indexdef)
      .filter((d) => /CREATE UNIQUE INDEX/i.test(d) && /email/i.test(d));

    expect(unicos).toHaveLength(1);
    expect(unicos[0]).toMatch(/\(tenant_id,\s*email\)/i);
    expect(unicos[0]).not.toMatch(/WHERE/i);

    // Y la global ya NO existe: si sobreviviera, el mismo correo en dos
    // inmobiliarias seguiría colisionando y R65 sería imposible.
    const globales = rows
      .map((r) => r.indexdef)
      .filter((d) => /CREATE UNIQUE INDEX/i.test(d) && /\(email\)/i.test(d));
    expect(globales).toEqual([]);
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
      `INSERT INTO tenant (nombre, nit, codigo) VALUES ('Auditada', '900-0006', 'auditada')
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

  // ─── T73 — D-12: el código de inmobiliaria (R73, R75, R76, R77) ──────────

  describe('tenant.codigo (#5 R73, R75, R77, D-12)', () => {
    /** Inserta un tenant con el código dado y devuelve el error, si lo hay. */
    async function intentarAlta(codigo: string, nit: string): Promise<unknown> {
      try {
        await pool.query(
          `INSERT INTO tenant (nombre, nit, codigo) VALUES ('Prueba Codigo', $1, $2)`,
          [nit, codigo],
        );
        return null;
      } catch (error) {
        return error;
      }
    }

    const RECHAZADOS: Array<[string, string]> = [
      ['mayúsculas', 'Arrendamientos'],
      ['tilde', 'arrendamientos-sión'],
      ['eñe', 'compañia'],
      ['guion inicial', '-arrendamientos'],
      ['guion final', 'arrendamientos-'],
      ['dos guiones seguidos', 'arre--ndamientos'],
      ['espacio interior', 'arrendamientos sion'],
      ['menos de 3 caracteres', 'ab'],
      ['más de 63 caracteres', 'a'.repeat(64)],
    ];

    it.each(RECHAZADOS)('el CHECK rechaza %s (R73)', async (_nombre, codigo) => {
      // `23514` = check_violation. El motor es la barrera, no el DTO: R77 exige
      // que valga también para un alta hecha a mano contra la base.
      await expect(intentarAlta(codigo, `nit-${codigo.length}-x`)).resolves.toMatchObject(
        { code: '23514' },
      );
    });

    it.each(['www', 'api', 'app', 'admin', 'portal', 'static', 'mail', 'cdn'])(
      'el CHECK rechaza el subdominio reservado %s (R75)',
      async (codigo) => {
        await expect(intentarAlta(codigo, `nit-res-${codigo}`)).resolves.toMatchObject({
          code: '23514',
        });
      },
    );

    it('acepta `arrendamientos-sion`, el caso del spec (R73)', async () => {
      await expect(
        intentarAlta('arrendamientos-sion', 'nit-ok-1'),
      ).resolves.toBeNull();
    });

    it('dos inmobiliarias no pueden compartir código (R73)', async () => {
      // `23505` = unique_violation. Sin esto, `tenant_por_codigo` sería
      // ambiguo y el login podría entrar en la inmobiliaria equivocada.
      await expect(
        intentarAlta('arrendamientos-sion', 'nit-ok-2'),
      ).resolves.toMatchObject({ code: '23505' });
    });

    it('tenant.codigo es NOT NULL: un alta sin código no entra (R73)', async () => {
      await expect(
        pool.query(`INSERT INTO tenant (nombre, nit) VALUES ('Sin Codigo', 'nit-sin')`),
      ).rejects.toMatchObject({ code: '23502' });
    });
  });

  describe('tenant_por_codigo, única ruta previa al tenant (#5 R52)', () => {
    it('resuelve por coincidencia EXACTA y devuelve solo el uuid', async () => {
      const { rows: creado } = await pool.query<{ id: string }>(
        `INSERT INTO tenant (nombre, nit, codigo)
         VALUES ('Resoluble', 'nit-resoluble', 'resoluble') RETURNING id`,
      );

      const { rows } = await pool.query<{ id: string | null }>(
        'SELECT tenant_por_codigo($1) AS id',
        ['resoluble'],
      );
      expect(rows[0]?.id).toBe(creado[0]?.id);

      // Ni prefijos, ni sufijos, ni patrones: si admitiera `LIKE`, el login se
      // convertiría en un enumerador de clientes del SaaS.
      for (const parcial of ['resolubl', 'resoluble2', '%', 'reso%', 'RESOLUBLE']) {
        const { rows: nada } = await pool.query<{ id: string | null }>(
          'SELECT tenant_por_codigo($1) AS id',
          [parcial],
        );
        expect(nada[0]?.id, `tenant_por_codigo('${parcial}')`).toBeNull();
      }
    });

    it('es SECURITY DEFINER y no está concedida a PUBLIC (R52)', async () => {
      const { rows } = await pool.query<{ prosecdef: boolean; proacl: string | null }>(
        `SELECT p.prosecdef, p.proacl::text AS proacl
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = 'tenant_por_codigo'`,
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]?.prosecdef).toBe(true);
      // Tras el REVOKE, el ACL deja de tener la entrada `=X/` de PUBLIC.
      expect(rows[0]?.proacl ?? '').not.toMatch(/(^|,)=X\//);
    });

    it('no hay ninguna OTRA función SECURITY DEFINER sobre `user` (R52, R18)', async () => {
      // R52 decía "única ruta" y R18 (feature #27) añade exactamente una más:
      // sesion_por_refresh_token, la única vía del refresh previa al tenant.
      // Si mañana alguien abre una tercera puerta que evite el RLS, este
      // test la ve.
      const { rows } = await pool.query<{ proname: string }>(
        `SELECT p.proname
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.prosecdef
          ORDER BY p.proname`,
      );

      expect(rows.map((r) => r.proname)).toEqual([
        'sesion_por_refresh_token',
        'tenant_por_codigo',
      ]);
    });
  });

  // ─── Feature #25 retencion_codeudor_referencias (T7: R1, R2, R3, R4, R5) ──

  describe('esquema de #25 (R1, R2, R3, R4, R5, R18, R25)', () => {
    const TABLAS_25 = [
      'tarifa_retencion',
      'codeudor_inquilino',
      'referencia_inquilino',
    ] as const;

    it.each(TABLAS_25)(
      'la tabla %s existe con RLS habilitado Y FORZADO (R4)',
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
        expect(rows[0]?.relrowsecurity).toBe(true);
        expect(rows[0]?.relforcerowsecurity).toBe(true);
      },
    );

    it.each(TABLAS_25)(
      'la política de aislamiento de %s filtra por app.current_tenant (R4)',
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

    it('tarifa_retencion tiene UNIQUE (tenant_id, anio) y porcentaje numeric(5,2) (R1)', async () => {
      // El UNIQUE se crea como índice único (patrón de `0005`), así que vive
      // en pg_indexes y no en information_schema.table_constraints.
      const { rows: unicos } = await pool.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes
          WHERE schemaname = 'public' AND tablename = 'tarifa_retencion'`,
      );
      expect(unicos.map((r) => r.indexname)).toContain(
        'tarifa_retencion_tenant_anio_key',
      );

      const { rows: columna } = await pool.query<{
        data_type: string;
        numeric_precision: string | number | null;
        numeric_scale: string | number | null;
      }>(
        `SELECT data_type, numeric_precision, numeric_scale
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'tarifa_retencion'
            AND column_name = 'porcentaje'`,
      );
      expect(columna[0]?.data_type).toBe('numeric');
      expect(Number(columna[0]?.numeric_precision)).toBe(5);
      expect(Number(columna[0]?.numeric_scale)).toBe(2);
    });

    it.each(['codeudor_inquilino', 'referencia_inquilino'] as const)(
      'la FK de %s hacia perfil_inquilino existe (R2, R3)',
      async (tabla) => {
        const { rows } = await pool.query<{ constraint_name: string }>(
          `SELECT tc.constraint_name
             FROM information_schema.table_constraints tc
             JOIN information_schema.key_column_usage kcu
               ON kcu.constraint_name = tc.constraint_name
              AND kcu.table_schema = tc.table_schema
             JOIN information_schema.constraint_column_usage ccu
               ON ccu.constraint_name = tc.constraint_name
              AND ccu.table_schema = tc.table_schema
            WHERE tc.table_schema = 'public'
              AND tc.table_name = $1
              AND tc.constraint_type = 'FOREIGN KEY'
              AND ccu.table_name = 'perfil_inquilino'`,
          [tabla],
        );

        expect(rows, `${tabla} debe declarar una FK hacia perfil_inquilino`).toHaveLength(1);
      },
    );

    it('ninguna FK de codeudor_inquilino ni referencia_inquilino apunta a contrato, firma, inventario u OTP (R18)', async () => {
      const { rows } = await pool.query<{ table_name: string; referenciada: string }>(
        `SELECT tc.table_name, ccu.table_name AS referenciada
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
             ON kcu.constraint_name = tc.constraint_name
            AND kcu.table_schema = tc.table_schema
           JOIN information_schema.constraint_column_usage ccu
             ON ccu.constraint_name = tc.constraint_name
            AND ccu.table_schema = tc.table_schema
          WHERE tc.table_schema = 'public'
            AND tc.table_name IN ('codeudor_inquilino', 'referencia_inquilino')
            AND tc.constraint_type = 'FOREIGN KEY'`,
      );

      const prohibidas = rows.filter((r) =>
        /contrato|firma|inventario|otp/i.test(r.referenciada),
      );
      expect(prohibidas).toEqual([]);
    });

    it('perfil_propietario sigue SIN ninguna columna de tarifa o porcentaje (R5)', async () => {
      // R5 / D-2: la tarifa vive únicamente en tarifa_retencion. El spec de la
      // #5 ya lo exigía; esta feature lo vuelve a verificar en su propia
      // migración, porque es el riesgo de regresión que la trae al mundo.
      const { rows } = await pool.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'perfil_propietario'`,
      );
      const columnas = rows.map((r) => r.column_name);
      const tarifas = columnas.filter((c) =>
        /porcentaje|tarifa|retencion_pct|pct_retencion/.test(c),
      );
      expect(tarifas).toEqual([]);
    });
  });

  // ─── Feature #27 sesion_y_revocacion (T7: R1, R2, R10, R18, R20) ─────────

  describe('esquema de #27 (R1, R2, R10, R18, R20)', () => {
    it('la tabla sesion existe con RLS habilitado Y FORZADO (R1)', async () => {
      const { rows } = await pool.query<{
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(
        `SELECT c.relrowsecurity, c.relforcerowsecurity
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relname = 'sesion'`,
      );

      expect(rows, 'la tabla sesion no existe').toHaveLength(1);
      expect(rows[0]?.relrowsecurity).toBe(true);
      expect(rows[0]?.relforcerowsecurity).toBe(true);
    });

    it('la política de aislamiento de sesion filtra por app.current_tenant (R1)', async () => {
      const { rows } = await pool.query<{ polname: string; qual: string | null }>(
        `SELECT policyname AS polname, qual
           FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sesion'`,
      );

      expect(rows.map((r) => r.polname)).toContain('sesion_tenant_isolation');
      const politica = rows.find((r) => r.polname === 'sesion_tenant_isolation');
      expect(politica?.qual).toContain('app.current_tenant');
    });

    it('user.token_version existe, NOT NULL, con default 0 (R2)', async () => {
      const { rows } = await pool.query<{
        is_nullable: string;
        column_default: string | null;
      }>(
        `SELECT is_nullable, column_default FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'user'
            AND column_name = 'token_version'`,
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]?.is_nullable).toBe('NO');
      expect(rows[0]?.column_default).toBe('0');
    });

    it('el índice único parcial sobre refresh_token_hash existe (R10)', async () => {
      const { rows } = await pool.query<{ indexname: string; indexdef: string }>(
        `SELECT indexname, indexdef FROM pg_indexes
          WHERE schemaname = 'public' AND tablename = 'sesion'`,
      );

      const unico = rows.find((r) => r.indexname === 'sesion_refresh_token_hash_key');
      expect(unico).toBeDefined();
      expect(unico?.indexdef).toMatch(/CREATE UNIQUE INDEX/i);
      expect(unico?.indexdef).toMatch(/WHERE .*refresh_token_hash.*IS NOT NULL/is);
    });

    it('sesion_por_refresh_token es SECURITY DEFINER, no está concedida a PUBLIC y devuelve el bootstrap mínimo (R18)', async () => {
      const { rows } = await pool.query<{
        prosecdef: boolean;
        proacl: string | null;
      }>(
        `SELECT p.prosecdef, p.proacl::text AS proacl
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = 'sesion_por_refresh_token'`,
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]?.prosecdef).toBe(true);
      // Tras el REVOKE, el ACL deja de tener la entrada `=X/` de PUBLIC.
      expect(rows[0]?.proacl ?? '').not.toMatch(/(^|,)=X\//);

      // El resultado es exactamente el bootstrap mínimo. `RETURNS TABLE`
      // devuelve el pseudo-tipo `record`, así que los nombres se leen de los
      // `fields` de una invocación vacía (0 filas, columnas declaradas).
      const resultado = await pool.query(
        'SELECT * FROM sesion_por_refresh_token(NULL::text)',
      );
      expect(resultado.fields?.map((f) => f.name)).toEqual([
        'id',
        'user_id',
        'tenant_id',
        'expira_en',
        'revocada_at',
      ]);
    });

    it('la función resuelve por coincidencia EXACTA de hash y devuelve solo los campos del bootstrap (R18)', async () => {
      const { rows: tenant } = await pool.query<{ id: string }>(
        `INSERT INTO tenant (nombre, nit, codigo)
         VALUES ('Sesiones', '900-0027', 'sesiones') RETURNING id`,
      );
      const tenantId = tenant[0]?.id;
      expect(tenantId).toBeDefined();

      const { rows: usuario } = await pool.query<{ id: string }>(
        `INSERT INTO "user" (tenant_id, email, password_hash, nombre)
         VALUES ($1, 'sesion@example.com', 'hash', 'Persona De Sesion') RETURNING id`,
        [tenantId],
      );
      const userId = usuario[0]?.id;

      const { rows: sesion } = await pool.query<{ id: string }>(
        `INSERT INTO sesion (user_id, tenant_id, refresh_token_hash, expira_en)
         VALUES ($1, $2, repeat('a', 64), now() + interval '30 days') RETURNING id`,
        [userId, tenantId],
      );
      const sesionId = sesion[0]?.id;

      const { rows: encontrada } = await pool.query<{
        id: string;
        user_id: string;
        tenant_id: string;
      }>(
        'SELECT id, user_id, tenant_id FROM sesion_por_refresh_token($1)',
        ['a'.repeat(64)],
      );
      expect(encontrada).toHaveLength(1);
      expect(encontrada[0]?.id).toBe(sesionId);
      expect(encontrada[0]?.user_id).toBe(userId);
      expect(encontrada[0]?.tenant_id).toBe(tenantId);

      // Ni prefijos, ni substrings, ni variaciones: coincidencia exacta.
      for (const parcial of ['a'.repeat(63), 'a'.repeat(65), `${'a'.repeat(32)}b${'a'.repeat(31)}`]) {
        const { rows: nada } = await pool.query<{ id: string }>(
          'SELECT id FROM sesion_por_refresh_token($1)',
          [parcial],
        );
        expect(nada, `sesion_por_refresh_token('${parcial.slice(0, 8)}…')`).toHaveLength(0);
      }
    });
  });
});
