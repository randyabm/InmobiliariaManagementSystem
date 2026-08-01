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
 * Invariantes de aislamiento de las plantillas contra **PostgreSQL real**
 * (T15 → R11, R12), incluidas las del sistema con su régimen especial
 * (PA-11-1). Mismo patrón que `workflows-rls.test.ts`.
 */
describe('Plantillas — RLS real (T15: R11, R12)', () => {
  let contenedor: StartedPostgreSqlContainer;
  let poolAdmin: Pool;
  let poolApp: Pool;
  let urlApp: string;

  const carpetaMigraciones = resolveMigrationsFolder(__dirname);

  const TENANT_A = '11111111-1111-1111-1111-111111111111';
  const TENANT_B = '22222222-2222-2222-2222-222222222222';
  const TENANT_SISTEMA = '00000000-0000-0000-0000-000000000000';

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
       VALUES ($1, 'A', '915111', 'plant-a'), ($2, 'B', '916222', 'plant-b')`,
      [TENANT_A, TENANT_B],
    );
    for (const tenant of [TENANT_A, TENANT_B]) {
      const { rows } = await poolAdmin.query<{ id: string }>(
        `INSERT INTO plantilla_inmueble (tenant_id, tipo, nombre, origen)
         VALUES ($1, 'CASA', 'Casa RLS', 'TENANT') RETURNING id`,
        [tenant],
      );
      const plantillaId = rows[0]?.id;
      await poolAdmin.query(
        `INSERT INTO plantilla_zona (plantilla_id, nombre) VALUES ($1, 'Zona RLS')`,
        [plantillaId],
      );
    }
  }, 180_000);

  afterAll(async () => {
    await poolApp?.end();
    await poolAdmin?.end();
    await contenedor?.stop();
  });

  it('un tenant lee la plantilla del sistema y sus zonas/ítems (PA-11-1)', async () => {
    const lectura = await comoTenant(TENANT_A, async (c) => {
      const { rows } = await c.query<{ tipo: string }>(
        `SELECT tipo FROM plantilla_inmueble WHERE tenant_id = $1`,
        [TENANT_SISTEMA],
      );
      return rows;
    });
    expect(lectura.map((f) => f.tipo)).toContain('APARTAMENTO');

    const { rows: sistema } = await poolAdmin.query<{ id: string }>(
      `SELECT id FROM plantilla_inmueble WHERE tipo = 'APARTAMENTO' AND origen = 'SISTEMA'`,
    );
    const zonas = await comoTenant(TENANT_A, async (c) => {
      const { rows } = await c.query(
        `SELECT id FROM plantilla_zona WHERE plantilla_id = $1`,
        [sistema[0]?.id],
      );
      return rows;
    });
    expect(zonas.length).toBeGreaterThan(0);
  });

  it('un SELECT * SIN WHERE sobre plantilla_inmueble devuelve solo lo propio o del sistema (R11)', async () => {
    const filas = await comoTenant(TENANT_A, async (c) => {
      const { rows } = await c.query<{ tenant_id: string }>(
        `SELECT * FROM plantilla_inmueble`,
      );
      return rows;
    });
    expect(filas.length).toBeGreaterThan(0);
    const ajenas = filas.filter(
      (f) => f.tenant_id !== TENANT_A && f.tenant_id !== TENANT_SISTEMA,
    );
    expect(ajenas).toEqual([]);
  });

  it('INSERT de una fila del sistema desde un contexto de tenant → rechazado (WITH CHECK)', async () => {
    await expect(
      comoTenant(TENANT_A, (c) =>
        c.query(
          `INSERT INTO plantilla_inmueble (tenant_id, tipo, nombre, origen)
           VALUES ($1, 'OFICINA', 'Intruso', 'SISTEMA')`,
          [TENANT_SISTEMA],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('INSERT de zona/ítem contra una plantilla del SISTEMA → rechazado (WITH CHECK)', async () => {
    const { rows: sistema } = await poolAdmin.query<{ id: string }>(
      `SELECT id FROM plantilla_inmueble WHERE tipo = 'APARTAMENTO' AND origen = 'SISTEMA'`,
    );
    await expect(
      comoTenant(TENANT_A, (c) =>
        c.query(
          `INSERT INTO plantilla_zona (plantilla_id, nombre) VALUES ($1, 'Hack')`,
          [sistema[0]?.id],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('en una conexión virgen (GUC nunca fijado), SELECT devuelve 0 filas (R12)', async () => {
    const poolVirgen = new Pool({ connectionString: urlApp, max: 1 });
    try {
      const cliente = await poolVirgen.connect();
      try {
        await cliente.query('BEGIN');
        for (const tabla of ['plantilla_inmueble', 'plantilla_zona', 'plantilla_item']) {
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
});
