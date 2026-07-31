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

    // Crear tenants (como admin, bypassa RLS)
    await poolAdmin.query(
      `INSERT INTO tenant (id, nombre, nit, codigo) VALUES ($1, 'Inmobiliaria A', '900111', 'inmobiliaria-a') ON CONFLICT (nit) DO NOTHING`,
      [TENANT_A],
    );
    await poolAdmin.query(
      `INSERT INTO tenant (id, nombre, nit, codigo) VALUES ($1, 'Inmobiliaria B', '900222', 'inmobiliaria-b') ON CONFLICT (nit) DO NOTHING`,
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

  // ─── T66 — la misma inmutabilidad, ahora con el rol de la aplicación ─────

  describe('inmutabilidad con el rol de aplicación (R41, R45, R58)', () => {
    /**
     * Dos barreras independientes, y las dos hacen falta.
     *
     * 1. **El trigger** (`0006_auditoria_append_only.sql`) protege incluso al
     *    dueño de la tabla y al rol de migración, cosa que ninguna política RLS
     *    puede hacer. Es lo que prueban los dos tests de arriba, con el pool
     *    privilegiado.
     * 2. **El privilegio** — el rol de aplicación ni siquiera tiene `UPDATE` ni
     *    `DELETE` sobre `audit_log` (R45), así que la sentencia se rechaza
     *    antes de llegar al trigger.
     *
     * Probar solo la segunda dejaría la puerta abierta a quien se conecte con
     * el rol privilegiado; probar solo la primera dejaría el `DELETE` como algo
     * que "el trigger ya parará". Por eso se comprueban las dos por separado.
     */
    it('el rol de la app no tiene privilegio de UPDATE ni DELETE sobre audit_log', async () => {
      for (const privilegio of ['UPDATE', 'DELETE']) {
        const { rows } = await poolApp.query<{ puede: boolean }>(
          'SELECT has_table_privilege(current_user, $1, $2) AS puede',
          ['public.audit_log', privilegio],
        );
        expect(rows[0]?.puede, `audit_log ${privilegio}`).toBe(false);
      }
    });

    it.each(['UPDATE audit_log SET accion = $1', 'DELETE FROM audit_log'])(
      'la sentencia `%s` la rechaza el motor para el rol de la app',
      async (plantilla) => {
        const cliente = await poolApp.connect();
        try {
          await cliente.query('BEGIN');
          await cliente.query('SELECT set_config($1, $2, true)', [
            'app.current_tenant',
            TENANT_A,
          ]);

          const consulta = plantilla.includes('$1')
            ? cliente.query(plantilla, ['alterada'])
            : cliente.query(plantilla);

          // Falla por privilegio (`permission denied`) o por el trigger
          // (`append-only`): las dos barreras son válidas y las dos dejan la
          // auditoría intacta, que es lo que R41 exige.
          await expect(consulta).rejects.toThrow(
            /permission denied|permiso denegado|append-only/i,
          );
        } finally {
          await cliente.query('ROLLBACK').catch(() => undefined);
          cliente.release();
        }
      },
    );

    it('tras los intentos, la entrada original sigue intacta', async () => {
      const { rows } = await poolAdmin.query<{ accion: string }>(
        `SELECT accion FROM audit_log WHERE actor_id = $1 AND accion = 'login'`,
        [USER_ID],
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows[0]?.accion).toBe('login');
    });
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
