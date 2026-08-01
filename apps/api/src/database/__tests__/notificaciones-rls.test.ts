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
 * Invariantes de aislamiento de las tablas de notificaciones contra
 * **PostgreSQL real** (Testcontainers) y con el rol de aplicación **sin
 * BYPASSRLS** (T17 → R14, R16). Mismo patrón que `clientes-rls.test.ts`.
 */
describe('Notificaciones — RLS real (T17: R14, R16)', () => {
  let contenedor: StartedPostgreSqlContainer;
  let poolAdmin: Pool;
  let poolApp: Pool;
  let urlApp: string;

  const carpetaMigraciones = resolveMigrationsFolder(__dirname);

  const TENANT_A = '11111111-1111-1111-1111-111111111111';
  const TENANT_B = '22222222-2222-2222-2222-222222222222';

  const TABLAS = [
    'notificacion_pendiente',
    'notificacion_enviada',
    'notificacion_programada',
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
    await asegurarRolDeAplicacion(connectionString, {
      usuario: USUARIO_APP_DE_PRUEBA,
      clave: CLAVE_APP_DE_PRUEBA,
    });

    const url = new URL(connectionString);
    url.username = USUARIO_APP_DE_PRUEBA;
    url.password = CLAVE_APP_DE_PRUEBA;
    urlApp = url.toString();
    poolApp = new Pool({ connectionString: urlApp });

    await poolAdmin.query(
      `INSERT INTO tenant (id, nombre, nit, codigo)
       VALUES ($1, 'A', '913111', 'notifrl-a'), ($2, 'B', '914222', 'notifrl-b')`,
      [TENANT_A, TENANT_B],
    );
    await poolAdmin.query(
      `INSERT INTO notificacion_pendiente (tenant_id, canal, destinatario, contenido)
       VALUES ($1, 'CORREO', 'a@example.com', '{}'),
              ($2, 'SMS', '3001112222', '{}')`,
      [TENANT_A, TENANT_B],
    );
    await poolAdmin.query(
      `INSERT INTO notificacion_enviada (tenant_id, canal, destinatario, estado)
       VALUES ($1, 'CORREO', 'a@example.com', 'PROCESADA'),
              ($2, 'SMS', '3001112222', 'PROCESADA')`,
      [TENANT_A, TENANT_B],
    );
    await poolAdmin.query(
      `INSERT INTO notificacion_programada
         (tenant_id, programada_para, destinatario, canal)
       VALUES ($1, now() + interval '1 day', 'a@example.com', 'CORREO'),
              ($2, now() + interval '1 day', '3001112222', 'SMS')`,
      [TENANT_A, TENANT_B],
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
    },
  );

  it.each(TABLAS)(
    'en una conexión virgen (GUC nunca fijado), SELECT sobre %s devuelve 0 filas (R16)',
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

  it('la función bootstrap devuelve los tenants con trabajo, no filas (R3)', async () => {
    const { rows } = await poolApp.query<{ tenant_id: string }>(
      'SELECT tenant_id FROM notificaciones_tenants_a_procesar()',
    );
    expect(rows.map((r) => r.tenant_id).sort()).toEqual([TENANT_A, TENANT_B].sort());
  });
});
