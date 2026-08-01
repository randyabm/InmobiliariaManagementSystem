import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { randomUUID } from 'node:crypto';
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
 * Invariantes de aislamiento de `sesion` contra **PostgreSQL real**
 * (Testcontainers) y con el rol de aplicación **sin BYPASSRLS** (T18 → R1,
 * R14, R16, R18; CHECKPOINTS.md §C7). Mismo patrón que `clientes-rls.test.ts`.
 *
 * La función `sesion_por_refresh_token` (R18) es la única vía del refresh
 * previa al tenant: aquí se verifica que resuelve por coincidencia exacta y
 * que un rol sin privilegios puede invocarla (el GRANT se lo da
 * `asegurarRolDeAplicacion`, no el test).
 */
describe('Sesiones — RLS real (T18: R1, R14, R16, R18)', () => {
  let contenedor: StartedPostgreSqlContainer;
  let poolAdmin: Pool;
  let poolApp: Pool;
  let urlApp: string;

  const carpetaMigraciones = resolveMigrationsFolder(__dirname);

  const TENANT_A = '11111111-1111-1111-1111-111111111111';
  const TENANT_B = '22222222-2222-2222-2222-222222222222';
  const USER_A = 'aaaaaaaa-0000-0000-0000-00000000000a';
  const USER_B = 'bbbbbbbb-0000-0000-0000-00000000000b';
  const HASH_A = 'a'.repeat(64);
  const HASH_B = 'b'.repeat(64);

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

    await poolAdmin.query(
      `INSERT INTO tenant (id, nombre, nit, codigo)
       VALUES ($1, 'Inmobiliaria A', '903111', 'inmobiliaria-a'),
              ($2, 'Inmobiliaria B', '904222', 'inmobiliaria-b')`,
      [TENANT_A, TENANT_B],
    );
    await poolAdmin.query(
      `INSERT INTO "user" (id, tenant_id, email, password_hash, nombre)
       VALUES ($1, $3, 'ses-a@example.com', NULL, 'Ses A'),
              ($2, $4, 'ses-b@example.com', NULL, 'Ses B')`,
      [USER_A, USER_B, TENANT_A, TENANT_B],
    );
    await poolAdmin.query(
      `INSERT INTO sesion (id, user_id, tenant_id, refresh_token_hash, expira_en)
       VALUES (gen_random_uuid(), $1, $2, $3, now() + interval '30 days'),
              (gen_random_uuid(), $4, $5, $6, now() + interval '30 days')`,
      [USER_A, TENANT_A, HASH_A, USER_B, TENANT_B, HASH_B],
    );
  }, 180_000);

  afterAll(async () => {
    await poolApp?.end();
    await poolAdmin?.end();
    await contenedor?.stop();
  });

  it('un SELECT * SIN WHERE sobre sesion devuelve solo las sesiones del tenant activo (R1, R14)', async () => {
    const filasA = await comoTenant(TENANT_A, async (c) => {
      const { rows } = await c.query<{ tenant_id: string }>(`SELECT * FROM sesion`);
      return rows;
    });
    expect(filasA.length).toBeGreaterThan(0);
    expect(filasA.every((f) => f.tenant_id === TENANT_A)).toBe(true);

    const filasB = await comoTenant(TENANT_B, async (c) => {
      const { rows } = await c.query<{ tenant_id: string }>(`SELECT * FROM sesion`);
      return rows;
    });
    expect(filasB.length).toBeGreaterThan(0);
    expect(filasB.every((f) => f.tenant_id === TENANT_B)).toBe(true);
  });

  it('en una conexión virgen (GUC nunca fijado), SELECT sobre sesion devuelve 0 filas (R16)', async () => {
    const poolVirgen = new Pool({ connectionString: urlApp, max: 1 });
    try {
      const cliente = await poolVirgen.connect();
      try {
        await cliente.query('BEGIN');
        const { rows } = await cliente.query(`SELECT * FROM sesion`);
        expect(rows).toHaveLength(0);
        await cliente.query('ROLLBACK');
      } finally {
        cliente.release();
      }
    } finally {
      await poolVirgen.end();
    }
  });

  it('pedir por id una sesión de otro tenant no la devuelve (R14)', async () => {
    const { rows: ajenas } = await poolAdmin.query<{ id: string }>(
      `SELECT id FROM sesion WHERE tenant_id = $1 LIMIT 1`,
      [TENANT_B],
    );
    const idAjeno = ajenas[0]?.id;
    expect(idAjeno).toBeDefined();

    const filas = await comoTenant(TENANT_A, async (c) => {
      const { rows } = await c.query(`SELECT * FROM sesion WHERE id = $1`, [idAjeno]);
      return rows;
    });
    expect(filas).toHaveLength(0);
  });

  it('sesion_por_refresh_token resuelve por coincidencia EXACTA de hash, con el rol de aplicación (R18)', async () => {
    // El GRANT lo aplicó `asegurarRolDeAplicacion`: si el rol no pudiera
    // ejecutarla, el refresh entero moriría en producción.
    const { rows } = await poolApp.query<{
      id: string;
      user_id: string;
      tenant_id: string;
    }>('SELECT id, user_id, tenant_id FROM sesion_por_refresh_token($1)', [HASH_A]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.user_id).toBe(USER_A);
    expect(rows[0]?.tenant_id).toBe(TENANT_A);

    // Ni substrings ni variaciones: el hash exacto o nada.
    for (const parcial of [HASH_A.slice(0, 63), `${HASH_A}00`, 'c'.repeat(64), '']) {
      const { rows: nada } = await poolApp.query<{ id: string }>(
        'SELECT id FROM sesion_por_refresh_token($1)',
        [parcial],
      );
      expect(nada).toHaveLength(0);
    }
  });

  it('la función también resuelve la huella del refresh ROTADO (R8, R18)', async () => {
    // El escenario de reuso: el hash viejo quedó como `refresh_token_hash_anterior`.
    const { rows } = await poolAdmin.query<{ id: string }>(
      `INSERT INTO sesion (id, user_id, tenant_id, refresh_token_hash,
                           refresh_token_hash_anterior, expira_en)
       VALUES ($1, $2, $3, $4, $5, now() + interval '30 days') RETURNING id`,
      [randomUUID(), USER_A, TENANT_A, 'd'.repeat(64), 'e'.repeat(64)],
    );
    const id = rows[0]?.id;
    expect(id).toBeDefined();

    const { rows: porAnterior } = await poolApp.query<{ id: string }>(
      'SELECT id FROM sesion_por_refresh_token($1)',
      ['e'.repeat(64)],
    );
    expect(porAnterior).toHaveLength(1);
    expect(porAnterior[0]?.id).toBe(id);
  });
});
