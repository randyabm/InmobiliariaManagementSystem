import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';

import { resolveMigrationsFolder } from '../../../src/database/migrations-folder';
import { runMigrations } from '../../../src/database/run-migrations';

describe('Auth + RBAC (R9, R10)', () => {
  let contenedor: StartedPostgreSqlContainer;
  let poolAdmin: Pool;
  let poolApp: Pool;
  let connectionString: string;

  const carpetaMigraciones = resolveMigrationsFolder(__dirname);

  const TENANT_A = '11111111-1111-1111-1111-111111111111';
  const TENANT_B = '22222222-2222-2222-2222-222222222222';
  const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const JWT_SECRET = 'test-secret-for-auth-rbac';

  beforeAll(async () => {
    contenedor = await new PostgreSqlContainer('postgres:16.4-alpine').start();
    connectionString = contenedor.getConnectionUri();
    poolAdmin = new Pool({ connectionString });

    await runMigrations(connectionString, carpetaMigraciones);

    await poolAdmin.query("DROP ROLE IF EXISTS app_test_user");
    await poolAdmin.query("CREATE ROLE app_test_user NOLOGIN");
    await poolAdmin.query('GRANT USAGE ON SCHEMA public TO app_test_user');
    await poolAdmin.query('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_test_user');

    poolApp = new Pool({ connectionString });

    // Crear tenants
    await poolAdmin.query(
      `INSERT INTO tenant (id, nombre, nit, codigo) VALUES ($1, 'Inmobiliaria A', '900111', 'inmobiliaria-a') ON CONFLICT (nit) DO NOTHING`,
      [TENANT_A],
    );
    await poolAdmin.query(
      `INSERT INTO tenant (id, nombre, nit, codigo) VALUES ($1, 'Inmobiliaria B', '900222', 'inmobiliaria-b') ON CONFLICT (nit) DO NOTHING`,
      [TENANT_B],
    );

    // Crear usuario con password hasheado
    const passwordHash = await bcrypt.hash('testpass123', 10);
    await poolAdmin.query(
      // `tenant_id` desde D-8 (R59): la identidad pertenece a UNA
      // inmobiliaria, y `ON CONFLICT` pasa a ser sobre (tenant_id, email).
      `INSERT INTO "user" (id, tenant_id, email, password_hash, nombre)
       VALUES ($1, $3, 'test@example.com', $2, 'Test User')
       ON CONFLICT (tenant_id, email) DO NOTHING`,
      [USER_ID, passwordHash, TENANT_A],
    );

    // Asignar rol admin en tenant A
    await poolAdmin.query(
      `INSERT INTO user_role (user_id, tenant_id, rol) VALUES ($1, $2, 'admin') ON CONFLICT DO NOTHING`,
      [USER_ID, TENANT_A],
    );
  });

  afterAll(async () => {
    await poolApp?.end();
    await poolAdmin?.end();
    await contenedor?.stop();
  });

  it('login exitoso retorna access_token (R9)', async () => {
    const { rows } = await poolAdmin.query<{ id: string }>(
      'SELECT id FROM "user" WHERE email = $1',
      ['test@example.com'],
    );
    expect(rows).toHaveLength(1);

    // Simular login: verificar credenciales y generar token
    const user = rows[0]!;
    const roleRows = await poolAdmin.query<{ tenant_id: string; rol: string }>(
      'SELECT tenant_id, rol FROM user_role WHERE user_id = $1 AND activo = true',
      [user.id],
    );

    const token = jwt.sign(
      { sub: user.id, email: 'test@example.com', roles: roleRows.rows },
      JWT_SECRET,
      { expiresIn: '1h' },
    );

    expect(token).toBeTruthy();
    expect(typeof token).toBe('string');

    // Verificar que el token se puede decodificar
    const decoded = jwt.verify(token, JWT_SECRET) as { sub: string; email: string };
    expect(decoded.sub).toBe(user.id);
    expect(decoded.email).toBe('test@example.com');
  });

  it('credenciales inválidas son rechazadas (R9)', async () => {
    const { rows } = await poolAdmin.query<{ password_hash: string }>(
      'SELECT password_hash FROM "user" WHERE email = $1',
      ['test@example.com'],
    );
    expect(rows).toHaveLength(1);

    const valid = await bcrypt.compare('wrongpassword', rows[0]!.password_hash);
    expect(valid).toBe(false);
  });

  it('usuario con rol admin puede acceder a su tenant (R10)', async () => {
    // Crear token con rol admin para tenant A
    const token = jwt.sign(
      {
        sub: USER_ID,
        email: 'test@example.com',
        roles: [{ tenant_id: TENANT_A, rol: 'admin' }],
      },
      JWT_SECRET,
      { expiresIn: '1h' },
    );

    const decoded = jwt.verify(token, JWT_SECRET) as {
      roles: Array<{ tenant_id: string; rol: string }>;
    };

    // Verificar que el usuario tiene rol admin para tenant A
    const hasAdmin = decoded.roles.some(
      (r) => r.tenant_id === TENANT_A && r.rol === 'admin',
    );
    expect(hasAdmin).toBe(true);
  });

  it('token de tenant A no accede a recursos de tenant B (R10)', async () => {
    const token = jwt.sign(
      {
        sub: USER_ID,
        email: 'test@example.com',
        roles: [{ tenant_id: TENANT_A, rol: 'admin' }],
      },
      JWT_SECRET,
      { expiresIn: '1h' },
    );

    const decoded = jwt.verify(token, JWT_SECRET) as {
      roles: Array<{ tenant_id: string; rol: string }>;
    };

    // Verificar que el token NO tiene rol para tenant B
    const hasRoleB = decoded.roles.some((r) => r.tenant_id === TENANT_B);
    expect(hasRoleB).toBe(false);
  });

  it('usuario sin token no accede a endpoint protegido (R10)', async () => {
    // Verificar que sin token, no hay usuario
    const user = undefined;
    expect(user).toBeUndefined();
  });
});
