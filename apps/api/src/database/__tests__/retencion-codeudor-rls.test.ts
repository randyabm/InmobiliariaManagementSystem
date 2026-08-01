import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { obtenerClienteTenant, SinContextoDeTenantError } from '../../../src/common/database/cliente-tenant';
import { resolveMigrationsFolder } from '../../../src/database/migrations-folder';
import { asegurarRolDeAplicacion } from '../../../src/database/rol-aplicacion';
import { runMigrations } from '../../../src/database/run-migrations';
import {
  CLAVE_APP_DE_PRUEBA,
  USUARIO_APP_DE_PRUEBA,
} from '../../../test/support/entorno-clientes';

/**
 * Invariantes de aislamiento de la feature #25, contra **PostgreSQL real**
 * (Testcontainers) y con el rol de aplicación **sin `BYPASSRLS`** (T22 → R4,
 * R19, R22; CHECKPOINTS.md §C7). Mismo patrón que `clientes-rls.test.ts`.
 *
 * El usuario por defecto del contenedor es superusuario y se salta el RLS:
 * las aserciones de aislamiento se hacen SIEMPRE con el rol de aplicación.
 */
describe('Retención y codeudores — RLS real (T22: R4, R19, R22)', () => {
  let contenedor: StartedPostgreSqlContainer;
  let poolAdmin: Pool;
  let poolApp: Pool;
  let urlApp: string;

  const carpetaMigraciones = resolveMigrationsFolder(__dirname);

  const TENANT_A = '11111111-1111-1111-1111-111111111111';
  const TENANT_B = '22222222-2222-2222-2222-222222222222';
  const INQUILINO_A = 'aaaaaaaa-1111-1111-1111-111111111111';
  const INQUILINO_B = 'bbbbbbbb-1111-1111-1111-111111111111';
  const TARIFA_B = 'bbbbbbbb-2222-0000-0000-000000000001';
  const CODEUDOR_B = 'bbbbbbbb-3333-0000-0000-000000000002';
  const REFERENCIA_B = 'bbbbbbbb-4444-0000-0000-000000000003';

  const TABLAS = [
    'tarifa_retencion',
    'codeudor_inquilino',
    'referencia_inquilino',
  ] as const;

  async function comoTenant<T>(
    tenantId: string | null,
    fn: (cliente: import('pg').PoolClient) => Promise<T>,
  ): Promise<T> {
    const cliente = await poolApp.connect();
    try {
      await cliente.query('BEGIN');
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

    await runMigrations(connectionString, carpetaMigraciones);

    // El rol sin privilegios lo provisiona `asegurarRolDeAplicacion` —el
    // mismo procedimiento de producción—, nunca este test (R57,
    // `tests/ddl-en-tests.test.ts`).
    await asegurarRolDeAplicacion(connectionString, {
      usuario: USUARIO_APP_DE_PRUEBA,
      clave: CLAVE_APP_DE_PRUEBA,
    });

    const url = new URL(connectionString);
    url.username = USUARIO_APP_DE_PRUEBA;
    url.password = CLAVE_APP_DE_PRUEBA;
    urlApp = url.toString();
    poolApp = new Pool({ connectionString: urlApp });

    // Datos sembrados como admin (superusuario): bypassa RLS a propósito,
    // así el test comprueba la lectura, no la escritura.
    await poolAdmin.query(
      `INSERT INTO tenant (id, nombre, nit, codigo)
       VALUES ($1, 'Inmobiliaria A', '901111', 'inmobiliaria-a'),
              ($2, 'Inmobiliaria B', '902222', 'inmobiliaria-b')`,
      [TENANT_A, TENANT_B],
    );
    await poolAdmin.query(
      `INSERT INTO "user" (id, tenant_id, email, password_hash, nombre)
       VALUES (gen_random_uuid(), $1, NULL, NULL, 'Inquilino A'),
              (gen_random_uuid(), $2, NULL, NULL, 'Inquilino B')`,
      [TENANT_A, TENANT_B],
    );
    const { rows: inquilinos } = await poolAdmin.query<{ id: string }>(
      `SELECT u.id FROM "user" u WHERE u.tenant_id IN ($1, $2) ORDER BY u.tenant_id`,
      [TENANT_A, TENANT_B],
    );
    await poolAdmin.query(
      `INSERT INTO perfil_inquilino
         (id, tenant_id, user_id, tipo_documento, documento,
          email_contacto, celular, medio_preferido_contacto)
       VALUES ($1, $2, $3, 'CC', '3010101', 'a@example.com', '3000000001', 'SMS'),
              ($4, $5, $6, 'CC', '3010102', 'b@example.com', '3000000002', 'SMS')`,
      [INQUILINO_A, TENANT_A, inquilinos[0]?.id, INQUILINO_B, TENANT_B, inquilinos[1]?.id],
    );
    await poolAdmin.query(
      `INSERT INTO tarifa_retencion (id, tenant_id, anio, porcentaje)
       VALUES (gen_random_uuid(), $1, 2026, '3.50'), ($2, $3, 2026, '7.00')`,
      [TENANT_A, TARIFA_B, TENANT_B],
    );
    await poolAdmin.query(
      `INSERT INTO codeudor_inquilino
         (id, tenant_id, perfil_inquilino_id, tipo, nombre, tipo_documento, documento)
       VALUES (gen_random_uuid(), $1, $2, 'CODEUDOR', 'Codeudor A', 'CC', '4010101'),
              ($3, $4, $5, 'CODEUDOR', 'Codeudor B', 'CC', '4010102')`,
      [TENANT_A, INQUILINO_A, CODEUDOR_B, TENANT_B, INQUILINO_B],
    );
    await poolAdmin.query(
      `INSERT INTO referencia_inquilino
         (id, tenant_id, perfil_inquilino_id, nombre, telefono)
       VALUES (gen_random_uuid(), $1, $2, 'Referencia A', '3120000001'),
              ($3, $4, $5, 'Referencia B', '3120000002')`,
      [TENANT_A, INQUILINO_A, REFERENCIA_B, TENANT_B, INQUILINO_B],
    );
  }, 180_000);

  afterAll(async () => {
    await poolApp?.end();
    await poolAdmin?.end();
    await contenedor?.stop();
  });

  it.each(TABLAS)(
    'un SELECT * SIN WHERE sobre %s devuelve solo filas del tenant activo (R4, R19)',
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

  it.each([
    ['tarifa_retencion', TARIFA_B],
    ['codeudor_inquilino', CODEUDOR_B],
    ['referencia_inquilino', REFERENCIA_B],
  ] as const)(
    'pedir por id una fila de otro tenant en %s no la devuelve (R19)',
    async (tabla, idAjeno) => {
      const filas = await comoTenant(TENANT_A, async (c) => {
        const { rows } = await c.query<{ id: string }>(
          `SELECT * FROM ${tabla} WHERE id = $1`,
          [idAjeno],
        );
        return rows;
      });
      expect(filas).toHaveLength(0);
    },
  );

  it.each(TABLAS)(
    'en una conexión virgen (GUC nunca fijado), SELECT sobre %s devuelve 0 filas (R22)',
    async (tabla) => {
      const poolVirgen = new Pool({ connectionString: urlApp, max: 1 });
      try {
        const cliente = await poolVirgen.connect();
        try {
          await cliente.query('BEGIN');
          const { rows } = await cliente.query(`SELECT * FROM ${tabla}`);
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

  it('un repositorio invocado sin tenantClient lanza SinContextoDeTenantError (R22)', () => {
    expect(() => obtenerClienteTenant({})).toThrow(SinContextoDeTenantError);
    expect(() => obtenerClienteTenant({ tenantClient: 'no-es-un-pool' })).toThrow(
      SinContextoDeTenantError,
    );
  });
});
