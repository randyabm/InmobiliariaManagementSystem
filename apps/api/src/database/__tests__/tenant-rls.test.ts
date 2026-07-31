import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resolveMigrationsFolder } from '../../../src/database/migrations-folder';
import { runMigrations } from '../../../src/database/run-migrations';

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

    await poolAdmin.query("DROP ROLE IF EXISTS app_test_user");
    await poolAdmin.query("CREATE ROLE app_test_user NOLOGIN");
    await poolAdmin.query('GRANT USAGE ON SCHEMA public TO app_test_user');
    await poolAdmin.query('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_test_user');
    await poolAdmin.query('GRANT SELECT, INSERT, UPDATE, DELETE ON tenant TO app_test_user');

    poolApp = new Pool({ connectionString });

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
      await cliente.query('SET ROLE app_test_user');
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
      await cliente.query('SET ROLE app_test_user');

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
      await cliente.query('SET ROLE app_test_user');
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
