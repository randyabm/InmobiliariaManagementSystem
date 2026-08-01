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
 * Invariantes de aislamiento de las cuatro tablas del inventario contra
 * **PostgreSQL real** (T17 → R8, R9). Mismo patrón que
 * `plantillas-rls.test.ts`: el rol de aplicación corre `SELECT *` SIN
 * `WHERE tenant_id` y la que filtra es la base, no el repositorio.
 */
describe('Inventario — RLS real (T17: R8, R9)', () => {
  let contenedor: StartedPostgreSqlContainer;
  let poolAdmin: Pool;
  let poolApp: Pool;
  let urlApp: string;

  const carpetaMigraciones = resolveMigrationsFolder(__dirname);

  const TENANT_A = '11111111-1111-1111-1111-111111111111';
  const TENANT_B = '22222222-2222-2222-2222-222222222222';

  const TABLAS = [
    'inventario',
    'inventario_zona',
    'inventario_item',
    'inventario_item_foto',
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
       VALUES ($1, 'A', '917111', 'inv-a'), ($2, 'B', '918222', 'inv-b')`,
      [TENANT_A, TENANT_B],
    );

    // Un inventario (BORRADOR + zona + ítem + foto) por tenant.
    for (const tenant of [TENANT_A, TENANT_B]) {
      const { rows: usuario } = await poolAdmin.query<{ id: string }>(
        `INSERT INTO "user" (tenant_id, email, nombre)
         VALUES ($1, $2, 'U Inv') RETURNING id`,
        [tenant, `u-inv-${tenant}@example.com`],
      );
      const { rows: prop } = await poolAdmin.query<{ id: string }>(
        `INSERT INTO perfil_propietario (tenant_id, user_id, tipo_documento, documento)
         VALUES ($1, $2, 'CC', $3) RETURNING id`,
        [tenant, usuario[0]?.id, `PI-${tenant}`],
      );
      const { rows: propiedad } = await poolAdmin.query<{ id: string }>(
        `INSERT INTO propiedad (tenant_id, direccion, tipo, area, canon, propietario_principal_id)
         VALUES ($1, 'Calle RLS', 'APARTAMENTO', '60.00', '1000000.00', $2) RETURNING id`,
        [tenant, prop[0]?.id],
      );
      const { rows: inv } = await poolAdmin.query<{ id: string }>(
        `INSERT INTO inventario (tenant_id, propiedad_id, tipo_evento)
         VALUES ($1, $2, 'ENTREGA') RETURNING id`,
        [tenant, propiedad[0]?.id],
      );
      const { rows: zona } = await poolAdmin.query<{ id: string }>(
        `INSERT INTO inventario_zona (tenant_id, inventario_id, nombre)
         VALUES ($1, $2, 'Zona RLS') RETURNING id`,
        [tenant, inv[0]?.id],
      );
      const { rows: item } = await poolAdmin.query<{ id: string }>(
        `INSERT INTO inventario_item (tenant_id, zona_id, nombre, field_type)
         VALUES ($1, $2, 'Item RLS', 'estado') RETURNING id`,
        [tenant, zona[0]?.id],
      );
      await poolAdmin.query(
        `INSERT INTO inventario_item_foto (tenant_id, item_id, clave_storage, hash_sha256, autor)
         VALUES ($1, $2, 'foto-rls.jpg', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'EMPLEADO')`,
        [tenant, item[0]?.id],
      );
    }
  }, 180_000);

  afterAll(async () => {
    await poolApp?.end();
    await poolAdmin?.end();
    await contenedor?.stop();
  });

  it('SELECT * SIN WHERE sobre las 4 tablas devuelve solo lo propio (R8)', async () => {
    for (const tabla of TABLAS) {
      const filas = await comoTenant(TENANT_A, async (c) => {
        const { rows } = await c.query<{ tenant_id: string }>(`SELECT * FROM ${tabla}`);
        return rows;
      });
      expect(filas.length, tabla).toBeGreaterThan(0);
      const ajenas = filas.filter((f) => f.tenant_id !== TENANT_A);
      expect(ajenas, tabla).toEqual([]);
    }
  });

  it('en una conexión virgen (GUC nunca fijado), SELECT devuelve 0 filas (R9)', async () => {
    const poolVirgen = new Pool({ connectionString: urlApp, max: 1 });
    try {
      const cliente = await poolVirgen.connect();
      try {
        await cliente.query('BEGIN');
        for (const tabla of TABLAS) {
          const { rows } = await cliente.query(`SELECT * FROM ${tabla}`);
          expect(rows, tabla).toHaveLength(0);
        }
        await cliente.query('ROLLBACK');
      } finally {
        cliente.release();
      }
    } finally {
      await poolVirgen.end();
    }
  });

  it('INSERT de un inventario ajeno → rechazado (WITH CHECK)', async () => {
    const { rows: propiedadB } = await poolAdmin.query<{ id: string }>(
      `SELECT id FROM propiedad WHERE tenant_id = $1 LIMIT 1`,
      [TENANT_B],
    );
    await expect(
      comoTenant(TENANT_A, (c) =>
        c.query(
          `INSERT INTO inventario (tenant_id, propiedad_id, tipo_evento)
           VALUES ($1, $2, 'ENTREGA')`,
          [TENANT_B, propiedadB[0]?.id],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('el borrador ajeno no se puede dar de baja desde otro tenant (0 filas afectadas)', async () => {
    const { rows: inventarioB } = await poolAdmin.query<{ id: string }>(
      `SELECT id FROM inventario WHERE tenant_id = $1 LIMIT 1`,
      [TENANT_B],
    );
    const afectadas = await comoTenant(TENANT_A, async (c) => {
      const { rowCount } = await c.query(
        `UPDATE inventario SET activo = false WHERE id = $1`,
        [inventarioB[0]?.id],
      );
      return rowCount ?? 0;
    });
    expect(afectadas).toBe(0);
  });
});
