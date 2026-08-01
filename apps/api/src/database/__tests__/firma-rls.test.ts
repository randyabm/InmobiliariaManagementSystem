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
 * Invariantes de aislamiento de `inventario_firma` contra PostgreSQL real
 * (T17 → R8, R9). Mismo patrón que `inventarios-rls.test.ts`.
 */
describe('Firma — RLS real (T17: R8, R9)', () => {
  let contenedor: StartedPostgreSqlContainer;
  let poolAdmin: Pool;
  let poolApp: Pool;
  let urlApp: string;

  const carpetaMigraciones = resolveMigrationsFolder(__dirname);

  const TENANT_A = '11111111-1111-1111-1111-111111111111';
  const TENANT_B = '22222222-2222-2222-2222-222222222222';

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

  async function sembrarFirma(tenantId: string): Promise<void> {
    const { rows: usuario } = await poolAdmin.query<{ id: string }>(
      `INSERT INTO "user" (tenant_id, email, nombre)
       VALUES ($1, $2, 'F RLS') RETURNING id`,
      [tenantId, `f-rls-${tenantId}-${Date.now()}@example.com`],
    );
    const { rows: prop } = await poolAdmin.query<{ id: string }>(
      `INSERT INTO perfil_propietario (tenant_id, user_id, tipo_documento, documento)
       VALUES ($1, $2, 'CC', $3) RETURNING id`,
      [tenantId, usuario[0]?.id, `FR-${tenantId}-${Date.now()}`],
    );
    const { rows: propiedad } = await poolAdmin.query<{ id: string }>(
      `INSERT INTO propiedad (tenant_id, direccion, tipo, area, canon, propietario_principal_id)
       VALUES ($1, 'Calle Firma', 'APARTAMENTO', '60.00', '1000000.00', $2) RETURNING id`,
      [tenantId, prop[0]?.id],
    );
    const { rows: inventario } = await poolAdmin.query<{ id: string }>(
      `INSERT INTO inventario (tenant_id, propiedad_id, tipo_evento, estado)
       VALUES ($1, $2, 'ENTREGA', 'ACORDADO') RETURNING id`,
      [tenantId, propiedad[0]?.id],
    );
    await poolAdmin.query(
      `INSERT INTO inventario_firma
         (tenant_id, inventario_id, firmante_tipo, firmante_user_id, hash_documento, ip)
       VALUES ($1, $2, 'EMPLEADO', $3, $4, '127.0.0.1')`,
      [tenantId, inventario[0]?.id, usuario[0]?.id, `${tenantId}0`.padEnd(64, 'a')],
    );
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
       VALUES ($1, 'A', '921111', 'fir-a'), ($2, 'B', '922222', 'fir-b')`,
      [TENANT_A, TENANT_B],
    );
    await sembrarFirma(TENANT_A);
    await sembrarFirma(TENANT_B);
  }, 180_000);

  afterAll(async () => {
    await poolApp?.end();
    await poolAdmin?.end();
    await contenedor?.stop();
  });

  it('SELECT * SIN WHERE sobre inventario_firma devuelve solo lo propio (R8)', async () => {
    const filas = await comoTenant(TENANT_A, async (c) => {
      const { rows } = await c.query<{ tenant_id: string }>('SELECT * FROM inventario_firma');
      return rows;
    });
    expect(filas.length).toBeGreaterThan(0);
    const ajenas = filas.filter((f) => f.tenant_id !== TENANT_A);
    expect(ajenas).toEqual([]);
  });

  it('en una conexión virgen, SELECT devuelve 0 filas (R9)', async () => {
    const poolVirgen = new Pool({ connectionString: urlApp, max: 1 });
    try {
      const cliente = await poolVirgen.connect();
      try {
        await cliente.query('BEGIN');
        const { rows } = await cliente.query('SELECT * FROM inventario_firma');
        expect(rows).toHaveLength(0);
        await cliente.query('ROLLBACK');
      } finally {
        cliente.release();
      }
    } finally {
      await poolVirgen.end();
    }
  });

  it('INSERT de una firma ajena → rechazado (WITH CHECK)', async () => {
    const { rows: inventarioB } = await poolAdmin.query<{ id: string }>(
      `SELECT id FROM inventario WHERE tenant_id = $1 LIMIT 1`,
      [TENANT_B],
    );
    const { rows: usuarioA } = await poolAdmin.query<{ id: string }>(
      `SELECT id FROM "user" WHERE tenant_id = $1 LIMIT 1`,
      [TENANT_A],
    );
    await expect(
      comoTenant(TENANT_A, (c) =>
        c.query(
          `INSERT INTO inventario_firma
             (tenant_id, inventario_id, firmante_tipo, firmante_user_id, hash_documento, ip)
           VALUES ($1, $2, 'EMPLEADO', $3, $4, '127.0.0.1')`,
          [TENANT_B, inventarioB[0]?.id, usuarioA[0]?.id, 'b'.repeat(64)],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});
