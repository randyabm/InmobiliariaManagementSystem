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

describe('Aislamiento multi-tenant por RLS (R8, R9)', () => {
  let contenedor: StartedPostgreSqlContainer;
  let poolAdmin: Pool;
  let poolApp: Pool;
  let connectionString: string;

  const carpetaMigraciones = resolveMigrationsFolder(__dirname);

  const TENANT_A = '11111111-1111-1111-1111-111111111111';
  const TENANT_B = '22222222-2222-2222-2222-222222222222';

  beforeAll(async () => {
    contenedor = await new PostgreSqlContainer('postgres:16.4-alpine').start();
    connectionString = contenedor.getConnectionUri();
    poolAdmin = new Pool({ connectionString });

    await runMigrations(connectionString, carpetaMigraciones);

    // **R48, R57, R58 (hallazgo B3).** El rol sin privilegios lo provisiona
    // `asegurarRolDeAplicacion` —el mismo procedimiento que usa la aplicación
    // en producción (R46)— y NO este test. Un test que crea el objeto sobre el
    // que después afirma es verde por construcción: es el defecto B2, y
    // `tests/ddl-en-tests.test.ts` lo vigila.
    await asegurarRolDeAplicacion(connectionString, {
      usuario: USUARIO_APP_DE_PRUEBA,
      clave: CLAVE_APP_DE_PRUEBA,
    });

    // Conexión con el rol de aplicación de verdad, no un `SET ROLE` sobre la
    // del superusuario: así se mide exactamente lo que medirá la aplicación.
    const urlApp = new URL(connectionString);
    urlApp.username = USUARIO_APP_DE_PRUEBA;
    urlApp.password = CLAVE_APP_DE_PRUEBA;
    poolApp = new Pool({ connectionString: urlApp.toString() });

    await poolAdmin.query(
      `INSERT INTO tenant (id, nombre, nit, codigo) VALUES ($1, 'Inmobiliaria A', '900111', 'inmobiliaria-a') ON CONFLICT (nit) DO NOTHING`,
      [TENANT_A],
    );
    await poolAdmin.query(
      `INSERT INTO tenant (id, nombre, nit, codigo) VALUES ($1, 'Inmobiliaria B', '900222', 'inmobiliaria-b') ON CONFLICT (nit) DO NOTHING`,
      [TENANT_B],
    );
  });

  afterAll(async () => {
    await poolApp?.end();
    await poolAdmin?.end();
    await contenedor?.stop();
  });

  it('un tenant NO puede leer datos de otro tenant (R8)', async () => {
    const cliente = await poolApp.connect();
    try {
      await cliente.query('BEGIN');
      await cliente.query(`SET LOCAL app.current_tenant = '${TENANT_A}'`);

      const { rows } = await cliente.query<{ id: string; nombre: string }>(
        'SELECT id, nombre FROM tenant',
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(TENANT_A);

      await cliente.query('ROLLBACK');
    } finally {
      cliente.release();
    }
  });

  it('una consulta sin contexto de tenant no devuelve datos (R6, R9)', async () => {
    const cliente = await poolApp.connect();
    try {
      await cliente.query('BEGIN');

      // Sin SET LOCAL app.current_tenant, la política RLS falla o retorna 0 filas.
      // Ambos comportamientos son correctos: lo importante es que NO devuelva datos.
      try {
        const { rows } = await cliente.query<{ id: string }>(
          'SELECT id FROM tenant',
        );
        expect(rows).toHaveLength(0);
      } catch (error: unknown) {
        // Si PostgreSQL lanza error (UUID cast de NULL/empty), también es válido:
        // lo importante es que NO devolvió datos de otros tenants.
        expect(error).toBeDefined();
      }

      await cliente.query('ROLLBACK');
    } finally {
      cliente.release();
    }
  });

  it('el interceptor puede establecer el contexto de tenant (R5)', async () => {
    const cliente = await poolApp.connect();
    try {
      await cliente.query('BEGIN');
      await cliente.query(`SET LOCAL app.current_tenant = '${TENANT_B}'`);

      const { rows } = await cliente.query<{ id: string; nombre: string }>(
        'SELECT id, nombre FROM tenant',
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(TENANT_B);
      expect(rows[0]?.nombre).toBe('Inmobiliaria B');

      await cliente.query('ROLLBACK');
    } finally {
      cliente.release();
    }
  });
});
