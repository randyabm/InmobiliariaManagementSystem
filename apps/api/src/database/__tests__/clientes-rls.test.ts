import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resolveMigrationsFolder } from '../../../src/database/migrations-folder';
import { runMigrations } from '../../../src/database/run-migrations';

/**
 * Invariantes de esquema y de aislamiento de la feature #5, verificados contra
 * **PostgreSQL real** (Testcontainers), nunca con mocks ni SQLite
 * (docs/verification.md Nivel 2, CHECKPOINTS.md §C4 y §C7).
 *
 * El aislamiento se ejercita con un rol **sin BYPASSRLS**: el usuario por
 * defecto del contenedor es superusuario y se saltaría el RLS, con lo que el
 * test sería verde sin demostrar nada. Mismo patrón que `audit-log.test.ts`.
 *
 * Cubre T9, T10, T37 y T38.
 */
describe('Clientes — esquema y aislamiento (#5 R4, R5, R7, R31, R34)', () => {
  let contenedor: StartedPostgreSqlContainer;
  let poolAdmin: Pool;
  let poolApp: Pool;

  const carpetaMigraciones = resolveMigrationsFolder(__dirname);

  const TENANT_A = '11111111-1111-1111-1111-111111111111';
  const TENANT_B = '22222222-2222-2222-2222-222222222222';
  const USER_A = 'aaaaaaaa-0000-0000-0000-00000000000a';
  const USER_B = 'bbbbbbbb-0000-0000-0000-00000000000b';
  const PERFIL_PROP_A = 'aaaaaaaa-1111-1111-1111-111111111111';
  const PERFIL_PROP_B = 'bbbbbbbb-1111-1111-1111-111111111111';
  const CUENTA_A = 'aaaaaaaa-2222-2222-2222-222222222222';
  const CUENTA_B = 'bbbbbbbb-2222-2222-2222-222222222222';

  /** Ejecuta `fn` con el rol sin privilegios y el tenant fijado (o sin él). */
  async function comoTenant<T>(
    tenantId: string | null,
    fn: (cliente: import('pg').PoolClient) => Promise<T>,
  ): Promise<T> {
    const cliente = await poolApp.connect();
    try {
      await cliente.query('BEGIN');
      await cliente.query('SET ROLE app_test_user');
      if (tenantId !== null) {
        await cliente.query(`SET LOCAL app.current_tenant = '${tenantId}'`);
      }
      return await fn(cliente);
    } finally {
      await cliente.query('ROLLBACK').catch(() => undefined);
      cliente.release();
    }
  }

  beforeAll(async () => {
    contenedor = await new PostgreSqlContainer('postgres:16.4-alpine').start();
    const connectionString = contenedor.getConnectionUri();
    poolAdmin = new Pool({ connectionString });
    poolApp = new Pool({ connectionString });

    await runMigrations(connectionString, carpetaMigraciones);

    await poolAdmin.query('DROP ROLE IF EXISTS app_test_user');
    await poolAdmin.query('CREATE ROLE app_test_user NOLOGIN');
    await poolAdmin.query('GRANT USAGE ON SCHEMA public TO app_test_user');
    await poolAdmin.query(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_test_user',
    );

    // Datos sembrados como admin (superusuario): bypassa RLS a propósito, así
    // el test comprueba la lectura, no la escritura.
    await poolAdmin.query(
      `INSERT INTO tenant (id, nombre, nit, codigo)
         VALUES ($1, 'Inmobiliaria A', '900111', 'inmobiliaria-a'),
                ($2, 'Inmobiliaria B', '900222', 'inmobiliaria-b')`,
      [TENANT_A, TENANT_B],
    );
    await poolAdmin.query(
      // D-8 (R59): cada identidad pertenece a su inmobiliaria.
      `INSERT INTO "user" (id, tenant_id, email, password_hash, nombre)
       VALUES ($1, $3, 'prop-a@example.com', NULL, 'Propietario A'),
              ($2, $4, 'prop-b@example.com', NULL, 'Propietario B')`,
      [USER_A, USER_B, TENANT_A, TENANT_B],
    );
    await poolAdmin.query(
      `INSERT INTO user_role (user_id, tenant_id, rol)
       VALUES ($1, $2, 'propietario'), ($3, $4, 'propietario')`,
      [USER_A, TENANT_A, USER_B, TENANT_B],
    );
    await poolAdmin.query(
      `INSERT INTO perfil_propietario (id, tenant_id, user_id, tipo_documento, documento)
       VALUES ($1, $2, $3, 'CC', '1010101010'), ($4, $5, $6, 'CC', '2020202020')`,
      [PERFIL_PROP_A, TENANT_A, USER_A, PERFIL_PROP_B, TENANT_B, USER_B],
    );
    await poolAdmin.query(
      `INSERT INTO perfil_inquilino (id, tenant_id, user_id, tipo_documento, documento, celular, medio_preferido_contacto)
       VALUES (gen_random_uuid(), $1, $2, 'CC', '3030303030', '3001112233', 'WHATSAPP'),
              (gen_random_uuid(), $3, $4, 'CC', '4040404040', '3004445566', 'CORREO')`,
      [TENANT_A, USER_A, TENANT_B, USER_B],
    );
    await poolAdmin.query(
      `INSERT INTO cuenta_bancaria
         (id, tenant_id, perfil_propietario_id, banco, tipo_cuenta, numero_cuenta,
          titular_nombre, titular_tipo_documento, titular_documento, es_predeterminada)
       VALUES ($1, $2, $3, 'Bancolombia', 'AHORROS', '111111', 'Propietario A', 'CC', '1010101010', true),
              ($4, $5, $6, 'Davivienda', 'CORRIENTE', '222222', 'Propietario B', 'CC', '2020202020', true)`,
      [CUENTA_A, TENANT_A, PERFIL_PROP_A, CUENTA_B, TENANT_B, PERFIL_PROP_B],
    );
  }, 180_000);

  afterAll(async () => {
    await poolApp?.end();
    await poolAdmin?.end();
    await contenedor?.stop();
  });

  // ─── T9 — unicidad de email tras D-5 (R7) ────────────────────────────────

  describe('unicidad de user.email tras D-5 (R7)', () => {
    it('admite varias identidades con email NULL', async () => {
      const cliente = await poolAdmin.connect();
      try {
        await cliente.query('BEGIN');
        await cliente.query(
          `INSERT INTO "user" (tenant_id, email, password_hash, nombre)
             VALUES ($1, NULL, NULL, 'Sin correo 1')`,
          [TENANT_A],
        );
        const { rowCount } = await cliente.query(
          `INSERT INTO "user" (tenant_id, email, password_hash, nombre)
             VALUES ($1, NULL, NULL, 'Sin correo 2')`,
          [TENANT_A],
        );
        expect(rowCount).toBe(1);

        const { rows } = await cliente.query<{ total: string }>(
          `SELECT count(*)::text AS total FROM "user" WHERE email IS NULL`,
        );
        expect(Number(rows[0]?.total)).toBe(2);
      } finally {
        await cliente.query('ROLLBACK');
        cliente.release();
      }
    });

    it('sigue rechazando dos identidades con el MISMO email no nulo', async () => {
      const cliente = await poolAdmin.connect();
      try {
        await cliente.query('BEGIN');
        await cliente.query(
          `INSERT INTO "user" (tenant_id, email, password_hash, nombre)
             VALUES ($1, 'duplicado@example.com', NULL, 'Uno')`,
          [TENANT_A],
        );

        await expect(
          cliente.query(
            `INSERT INTO "user" (tenant_id, email, password_hash, nombre)
               VALUES ($1, 'duplicado@example.com', NULL, 'Dos')`,
            [TENANT_A],
          ),
        ).rejects.toMatchObject({ code: '23505' });
      } finally {
        await cliente.query('ROLLBACK');
        cliente.release();
      }
    });
  });

  // ─── T10 — índice único parcial de cuenta predeterminada (R4) ────────────

  describe('una sola cuenta predeterminada por propietario (R4)', () => {
    it('rechaza una segunda cuenta activa con es_predeterminada = true', async () => {
      const cliente = await poolAdmin.connect();
      try {
        await cliente.query('BEGIN');

        await expect(
          cliente.query(
            `INSERT INTO cuenta_bancaria
               (tenant_id, perfil_propietario_id, banco, tipo_cuenta, numero_cuenta,
                titular_nombre, titular_tipo_documento, titular_documento, es_predeterminada, activa)
             VALUES ($1, $2, 'Bancolombia', 'AHORROS', '999999', 'Propietario A', 'CC', '1010101010', true, true)`,
            [TENANT_A, PERFIL_PROP_A],
          ),
        ).rejects.toMatchObject({ code: '23505' });
      } finally {
        await cliente.query('ROLLBACK');
        cliente.release();
      }
    });

    it('admite varias cuentas del mismo propietario si solo una es predeterminada', async () => {
      const cliente = await poolAdmin.connect();
      try {
        await cliente.query('BEGIN');
        const { rowCount } = await cliente.query(
          `INSERT INTO cuenta_bancaria
             (tenant_id, perfil_propietario_id, banco, tipo_cuenta, numero_cuenta,
              titular_nombre, titular_tipo_documento, titular_documento, es_predeterminada, activa)
           VALUES ($1, $2, 'Nequi', 'AHORROS', '888888', 'Propietario A', 'CC', '1010101010', false, true)`,
          [TENANT_A, PERFIL_PROP_A],
        );
        expect(rowCount).toBe(1);
      } finally {
        await cliente.query('ROLLBACK');
        cliente.release();
      }
    });

    it('el índice es parcial: una cuenta INACTIVA predeterminada no bloquea a la activa', async () => {
      const cliente = await poolAdmin.connect();
      try {
        await cliente.query('BEGIN');
        const { rowCount } = await cliente.query(
          `INSERT INTO cuenta_bancaria
             (tenant_id, perfil_propietario_id, banco, tipo_cuenta, numero_cuenta,
              titular_nombre, titular_tipo_documento, titular_documento, es_predeterminada, activa)
           VALUES ($1, $2, 'Banco viejo', 'AHORROS', '777777', 'Propietario A', 'CC', '1010101010', true, false)`,
          [TENANT_A, PERFIL_PROP_A],
        );
        expect(rowCount).toBe(1);
      } finally {
        await cliente.query('ROLLBACK');
        cliente.release();
      }
    });
  });

  // ─── T37 — aislamiento por tenant en las tres tablas (R5, R31) ───────────

  describe('aislamiento por tenant con RLS FORCE (R5, R31)', () => {
    const TABLAS = ['perfil_propietario', 'perfil_inquilino', 'cuenta_bancaria'] as const;

    it.each(TABLAS)(
      'un SELECT * SIN WHERE sobre %s devuelve solo filas del tenant activo',
      async (tabla) => {
        const filasA = await comoTenant(TENANT_A, async (c) => {
          const { rows } = await c.query<{ tenant_id: string }>(`SELECT * FROM ${tabla}`);
          return rows;
        });

        expect(filasA.length).toBeGreaterThan(0);
        expect(filasA.every((f) => f.tenant_id === TENANT_A)).toBe(true);

        const filasB = await comoTenant(TENANT_B, async (c) => {
          const { rows } = await c.query<{ tenant_id: string }>(`SELECT * FROM ${tabla}`);
          return rows;
        });

        expect(filasB.length).toBeGreaterThan(0);
        expect(filasB.every((f) => f.tenant_id === TENANT_B)).toBe(true);
      },
    );

    it('pedir por id una fila de otro tenant no la devuelve (R31)', async () => {
      const filas = await comoTenant(TENANT_A, async (c) => {
        const { rows } = await c.query('SELECT * FROM perfil_propietario WHERE id = $1', [
          PERFIL_PROP_B,
        ]);
        return rows;
      });

      expect(filas).toHaveLength(0);
    });

    it('un UPDATE dirigido a una fila de otro tenant no afecta ninguna fila (R31)', async () => {
      const afectadas = await comoTenant(TENANT_A, async (c) => {
        const { rowCount } = await c.query(
          'UPDATE perfil_propietario SET activo = false WHERE id = $1',
          [PERFIL_PROP_B],
        );
        return rowCount;
      });

      expect(afectadas).toBe(0);

      const { rows } = await poolAdmin.query<{ activo: boolean }>(
        'SELECT activo FROM perfil_propietario WHERE id = $1',
        [PERFIL_PROP_B],
      );
      expect(rows[0]?.activo).toBe(true);
    });

    it('no se puede INSERTAR una fila con el tenant_id de otro (R31)', async () => {
      await expect(
        comoTenant(TENANT_A, (c) =>
          c.query(
            `INSERT INTO perfil_propietario (tenant_id, user_id, tipo_documento, documento)
             VALUES ($1, $2, 'CC', '5050505050')`,
            [TENANT_B, USER_B],
          ),
        ),
      ).rejects.toThrow(/row-level security/i);
    });
  });

  // ─── T38 — sin contexto de tenant no se ve nada (R34) ────────────────────

  describe('sin contexto de tenant (R34)', () => {
    const TABLAS = ['perfil_propietario', 'perfil_inquilino', 'cuenta_bancaria'] as const;

    it.each(TABLAS)(
      'en una conexión virgen (GUC nunca fijado), SELECT sobre %s devuelve 0 filas',
      async (tabla) => {
        // Conexión NUEVA a propósito: `current_setting('app.current_tenant',
        // true)` solo devuelve NULL si el GUC no se fijó nunca en la sesión.
        // Reutilizar una conexión del pool que ya tuvo un `SET LOCAL` deja el
        // GUC presente con valor vacío, que es el otro caso (test siguiente).
        const poolVirgen = new Pool({
          connectionString: contenedor.getConnectionUri(),
          max: 1,
        });
        try {
          const cliente = await poolVirgen.connect();
          try {
            await cliente.query('BEGIN');
            await cliente.query('SET ROLE app_test_user');

            const { rows } = await cliente.query(`SELECT * FROM ${tabla}`);

            // docs/architecture.md: sin contexto de tenant NO se devuelve
            // todo. La política compara con NULL, que nunca es verdadero.
            expect(rows).toHaveLength(0);

            await cliente.query('ROLLBACK');
          } finally {
            cliente.release();
          }
        } finally {
          await poolVirgen.end();
        }
      },
    );

    it.each(TABLAS)(
      'con el GUC presente pero VACÍO, la consulta a %s falla y no devuelve filas',
      async (tabla) => {
        // Este es el caso de una conexión reciclada del pool cuyo `SET LOCAL`
        // se deshizo al cerrar la transacción: el GUC sigue existiendo con
        // valor vacío. Se reproduce de forma explícita (`= ''`) en vez de
        // confiar en el reciclaje del pool, para que el test sea determinista.
        // La política intenta castear '' a uuid y la consulta ABORTA (22P02):
        // docs/architecture.md, "una consulta sin contexto de tenant debe
        // fallar, no devolver todo".
        await expect(
          comoTenant('', (c) => c.query(`SELECT * FROM ${tabla}`)),
        ).rejects.toMatchObject({ code: '22P02' });
      },
    );
  });
});
