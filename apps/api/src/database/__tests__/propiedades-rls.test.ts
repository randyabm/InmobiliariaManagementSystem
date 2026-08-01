import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resolveMigrationsFolder } from '../../../src/database/migrations-folder';
import { asegurarRolDeAplicacion } from '../../../src/database/rol-aplicacion';
import { runMigrations } from '../../../src/database/run-migrations';
import {
  CLAVE_APP_DE_PRUEBA,
  USUARIO_APP_DE_PRUEBA,
} from '../../../test/support/entorno-clientes';

/**
 * Invariantes de aislamiento de las cuatro tablas de #6 contra **PostgreSQL
 * real** (Testcontainers) y con el rol de aplicación **sin BYPASSRLS** (T19
 * → R14, R19; CHECKPOINTS.md §C7). Mismo patrón que `clientes-rls.test.ts`.
 */
describe('Propiedades — RLS real (T19: R14, R19)', () => {
  let contenedor: StartedPostgreSqlContainer;
  let poolAdmin: Pool;
  let poolApp: Pool;
  let urlApp: string;

  const carpetaMigraciones = resolveMigrationsFolder(__dirname);

  const TENANT_A = '11111111-1111-1111-1111-111111111111';
  const TENANT_B = '22222222-2222-2222-2222-222222222222';
  const USER_A = 'aaaaaaaa-0000-0000-0000-00000000000a';
  const USER_B = 'bbbbbbbb-0000-0000-0000-00000000000b';
  const PERFIL_PROP_A = 'aaaaaaaa-1111-1111-1111-111111111111';
  const PERFIL_PROP_B = 'bbbbbbbb-1111-1111-1111-111111111111';
  const PERFIL_INQ_A = 'aaaaaaaa-2222-2222-2222-222222222222';
  const PERFIL_INQ_B = 'bbbbbbbb-2222-2222-2222-222222222222';
  const PROPIEDAD_A = 'aaaaaaaa-3333-3333-3333-333333333333';
  const PROPIEDAD_B = 'bbbbbbbb-3333-3333-3333-333333333333';
  const DOCUMENTO_B = 'bbbbbbbb-4444-4444-4444-444444444444';

  const TABLAS = [
    'propiedad',
    'propiedad_propietario',
    'historial_ocupacion',
    'propiedad_documento',
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
    // mismo procedimiento de producción—, nunca este test (R57).
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
       VALUES ($1, 'Inmobiliaria A', '905111', 'inmobiliaria-a'),
              ($2, 'Inmobiliaria B', '906222', 'inmobiliaria-b')`,
      [TENANT_A, TENANT_B],
    );
    await poolAdmin.query(
      `INSERT INTO "user" (id, tenant_id, email, password_hash, nombre)
       VALUES ($1, $3, 'rlsp-a@example.com', NULL, 'RLS Prop A'),
              ($2, $4, 'rlsp-b@example.com', NULL, 'RLS Prop B')`,
      [USER_A, USER_B, TENANT_A, TENANT_B],
    );
    await poolAdmin.query(
      `INSERT INTO perfil_propietario (id, tenant_id, user_id, tipo_documento, documento)
       VALUES ($1, $2, $3, 'CC', '6010101'), ($4, $5, $6, 'CC', '6010102')`,
      [PERFIL_PROP_A, TENANT_A, USER_A, PERFIL_PROP_B, TENANT_B, USER_B],
    );
    await poolAdmin.query(
      `INSERT INTO perfil_inquilino (id, tenant_id, user_id, tipo_documento, documento, email_contacto, celular, medio_preferido_contacto)
       VALUES ($1, $2, $3, 'CC', '6020101', 'inq-a@example.com', '3000000001', 'SMS'),
              ($4, $5, $6, 'CC', '6020102', 'inq-b@example.com', '3000000002', 'SMS')`,
      [PERFIL_INQ_A, TENANT_A, USER_A, PERFIL_INQ_B, TENANT_B, USER_B],
    );
    await poolAdmin.query(
      `INSERT INTO propiedad
         (id, tenant_id, direccion, tipo, area, canon, propietario_principal_id)
       VALUES ($1, $2, 'Calle RLS A', 'APARTAMENTO', '60.00', '1000000.00', $3),
              ($4, $5, 'Calle RLS B', 'CASA', '80.00', '1500000.00', $6)`,
      [PROPIEDAD_A, TENANT_A, PERFIL_PROP_A, PROPIEDAD_B, TENANT_B, PERFIL_PROP_B],
    );
    await poolAdmin.query(
      `INSERT INTO propiedad_propietario (tenant_id, propiedad_id, perfil_propietario_id)
       VALUES ($1, $2, $3), ($4, $5, $6)`,
      [TENANT_A, PROPIEDAD_A, PERFIL_PROP_A, TENANT_B, PROPIEDAD_B, PERFIL_PROP_B],
    );
    await poolAdmin.query(
      `INSERT INTO historial_ocupacion (tenant_id, propiedad_id, perfil_inquilino_id, desde)
       VALUES ($1, $2, $3, now() - interval '10 days'),
              ($4, $5, $6, now() - interval '20 days')`,
      [TENANT_A, PROPIEDAD_A, PERFIL_INQ_A, TENANT_B, PROPIEDAD_B, PERFIL_INQ_B],
    );
    await poolAdmin.query(
      `INSERT INTO propiedad_documento
         (id, tenant_id, propiedad_id, nombre, clave_storage, hash_sha256)
       VALUES (gen_random_uuid(), $1, $2, 'doc-a.pdf', 'clave-a', repeat('a', 64)),
              ($3, $4, $5, 'doc-b.pdf', 'clave-b', repeat('b', 64))`,
      [TENANT_A, PROPIEDAD_A, DOCUMENTO_B, TENANT_B, PROPIEDAD_B],
    );
  }, 180_000);

  afterAll(async () => {
    await poolApp?.end();
    await poolAdmin?.end();
    await contenedor?.stop();
  });

  it.each(TABLAS)(
    'un SELECT * SIN WHERE sobre %s devuelve solo filas del tenant activo (R14)',
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
    ['propiedad', PROPIEDAD_B],
    ['propiedad_documento', DOCUMENTO_B],
  ] as const)(
    'pedir por id una fila de otro tenant en %s no la devuelve (R14)',
    async (tabla, idAjeno) => {
      const filas = await comoTenant(TENANT_A, async (c) => {
        const { rows } = await c.query(`SELECT * FROM ${tabla} WHERE id = $1`, [idAjeno]);
        return rows;
      });
      expect(filas).toHaveLength(0);
    },
  );

  it.each(TABLAS)(
    'en una conexión virgen (GUC nunca fijado), SELECT sobre %s devuelve 0 filas (R19)',
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
});
