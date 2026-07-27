import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resolveMigrationsFolder } from '../../../src/database/migrations-folder';
import { runMigrations } from '../../../src/database/run-migrations';

describe('Audit log — append-only (R6, R7)', () => {
  let contenedor: StartedPostgreSqlContainer;
  let poolAdmin: Pool;
  let poolApp: Pool;
  let connectionString: string;

  const carpetaMigraciones = resolveMigrationsFolder(__dirname);

  const TENANT_A = '11111111-1111-1111-1111-111111111111';
  const TENANT_B = '22222222-2222-2222-2222-222222222222';
  const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  beforeAll(async () => {
    contenedor = await new PostgreSqlContainer('postgres:16.4-alpine').start();
    connectionString = contenedor.getConnectionUri();
    poolAdmin = new Pool({ connectionString });

    await runMigrations(connectionString, carpetaMigraciones);

    // NO se crean aquí la función ni los triggers append-only: los instala la
    // migración `0006_auditoria_append_only.sql` (R40). Hasta la revisión de
    // #5 este `beforeAll` los fabricaba justo antes de afirmar que existían,
    // así que el test era verde por construcción mientras en producción
    // `audit_log` era mutable (hallazgo B2). Si esa migración desaparece o se
    // le comenta el `CREATE TRIGGER`, los dos tests de inmutabilidad de este
    // archivo se ponen ROJOS, que es lo que debía ocurrir desde la #4 (R57).

    await poolAdmin.query('DROP ROLE IF EXISTS app_test_user');
    await poolAdmin.query("CREATE ROLE app_test_user NOLOGIN");
    await poolAdmin.query('GRANT USAGE ON SCHEMA public TO app_test_user');
    await poolAdmin.query('GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA public TO app_test_user');
    await poolAdmin.query('GRANT SELECT, INSERT ON audit_log TO app_test_user');
    await poolAdmin.query('GRANT SELECT, INSERT ON tenant TO app_test_user');
    await poolAdmin.query('GRANT SELECT, INSERT ON "user" TO app_test_user');
    await poolAdmin.query('GRANT SELECT, INSERT ON user_role TO app_test_user');

    poolApp = new Pool({ connectionString });

    // Crear tenants (como admin, bypassa RLS)
    await poolAdmin.query(
      `INSERT INTO tenant (id, nombre, nit) VALUES ($1, 'Inmobiliaria A', '900111') ON CONFLICT (nit) DO NOTHING`,
      [TENANT_A],
    );
    await poolAdmin.query(
      `INSERT INTO tenant (id, nombre, nit) VALUES ($1, 'Inmobiliaria B', '900222') ON CONFLICT (nit) DO NOTHING`,
      [TENANT_B],
    );

    // Insertar registro de auditoría como admin (para tests de append-only)
    await poolAdmin.query(
      `INSERT INTO audit_log (tenant_id, actor_id, actor_email, accion, entity_type, entity_id, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [TENANT_A, USER_ID, 'test@example.com', 'login', 'user', USER_ID, '127.0.0.1'],
    );
  });

  afterAll(async () => {
    await poolApp?.end();
    await poolAdmin?.end();
    await contenedor?.stop();
  });

  it('INSERT de un registro de auditoría funciona (R6)', async () => {
    const cliente = await poolApp.connect();
    try {
      await cliente.query('BEGIN');
      await cliente.query('SET ROLE app_test_user');
      await cliente.query(`SET LOCAL app.current_tenant = '${TENANT_A}'`);

      const { rowCount } = await cliente.query(
        `INSERT INTO audit_log (tenant_id, actor_id, actor_email, accion, entity_type, entity_id, ip_address)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [TENANT_A, USER_ID, 'test@example.com', 'insert_test', 'user', USER_ID, '127.0.0.1'],
      );

      expect(rowCount).toBe(1);
      await cliente.query('ROLLBACK');
    } finally {
      cliente.release();
    }
  });

  it('SELECT funciona normalmente (R6)', async () => {
    const cliente = await poolApp.connect();
    try {
      await cliente.query('BEGIN');
      await cliente.query('SET ROLE app_test_user');
      await cliente.query(`SET LOCAL app.current_tenant = '${TENANT_A}'`);

      const { rows } = await cliente.query<{ id: string; accion: string }>(
        'SELECT id, accion FROM audit_log',
      );

      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows[0]?.accion).toBe('login');

      await cliente.query('ROLLBACK');
    } finally {
      cliente.release();
    }
  });

  it('los triggers append-only los instala la migración, no el test (R40)', async () => {
    const { rows } = await poolAdmin.query<{ tgname: string; proname: string }>(
      `SELECT t.tgname, p.proname
         FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_proc p ON p.oid = t.tgfoid
        WHERE c.relname = 'audit_log' AND NOT t.tgisinternal
        ORDER BY t.tgname`,
    );

    expect(
      rows.map((fila) => fila.tgname),
      'los triggers deben venir de 0006_auditoria_append_only.sql: este test ' +
        'no los crea',
    ).toEqual(['trg_audit_log_no_delete', 'trg_audit_log_no_update']);
    expect(new Set(rows.map((fila) => fila.proname))).toEqual(
      new Set(['audit_log_prevent_mutation']),
    );
  });

  it('UPDATE sobre audit_log lanza error — append-only (R6, R41)', async () => {
    const { rows } = await poolAdmin.query<{ id: string }>('SELECT id FROM audit_log LIMIT 1');
    expect(rows.length).toBe(1);

    await expect(
      poolAdmin.query(`UPDATE audit_log SET accion = 'hacked' WHERE id = $1`, [rows[0]!.id]),
    ).rejects.toThrow(/append-only/i);
  });

  it('DELETE sobre audit_log lanza error — append-only (R6, R41)', async () => {
    const { rows } = await poolAdmin.query<{ id: string }>('SELECT id FROM audit_log LIMIT 1');
    expect(rows.length).toBe(1);

    await expect(
      poolAdmin.query('DELETE FROM audit_log WHERE id = $1', [rows[0]!.id]),
    ).rejects.toThrow(/append-only/i);
  });

  it('un tenant NO puede leer registros de otro tenant (R6)', async () => {
    // Insertar registro en tenant B (como admin, bypassa RLS)
    await poolAdmin.query(
      `INSERT INTO audit_log (tenant_id, accion, entity_type)
       VALUES ($1, 'test_tenant_b_only', 'user')`,
      [TENANT_B],
    );

    // Leer como tenant A — no debe ver registros de B
    const cliente = await poolApp.connect();
    try {
      await cliente.query('BEGIN');
      await cliente.query('SET ROLE app_test_user');
      await cliente.query(`SET LOCAL app.current_tenant = '${TENANT_A}'`);

      const { rows } = await cliente.query<{ id: string; accion: string }>(
        "SELECT id, accion FROM audit_log WHERE accion = 'test_tenant_b_only'",
      );

      expect(rows).toHaveLength(0);
      await cliente.query('ROLLBACK');
    } finally {
      cliente.release();
    }
  });

  it('login exitoso genera entrada de auditoría (R7)', async () => {
    const cliente = await poolApp.connect();
    try {
      await cliente.query('BEGIN');
      await cliente.query('SET ROLE app_test_user');
      await cliente.query(`SET LOCAL app.current_tenant = '${TENANT_A}'`);

      const uniqueUserId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
      await cliente.query(
        `INSERT INTO audit_log (tenant_id, actor_id, actor_email, accion, entity_type, entity_id, ip_address)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [TENANT_A, uniqueUserId, 'unique-test@example.com', 'login', 'user', uniqueUserId, '10.0.0.1'],
      );

      const { rows } = await cliente.query<{ accion: string; actor_email: string; ip_address: string }>(
        `SELECT accion, actor_email, ip_address FROM audit_log
         WHERE actor_id = $1`,
        [uniqueUserId],
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]?.accion).toBe('login');
      expect(rows[0]?.actor_email).toBe('unique-test@example.com');
      expect(rows[0]?.ip_address).toBe('10.0.0.1');

      await cliente.query('ROLLBACK');
    } finally {
      cliente.release();
    }
  });
});
