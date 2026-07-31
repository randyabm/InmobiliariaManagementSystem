import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resolveMigrationsFolder } from '../../../src/database/migrations-folder';
import { asegurarRolDeAplicacion } from '../../../src/database/rol-aplicacion';
import { runMigrations } from '../../../src/database/run-migrations';

/**
 * **T56 — R49, R59, R60**: `user` es ya una tabla de negocio por inmobiliaria,
 * y quien lo garantiza es **el motor**, no el `WHERE` de ningún repositorio.
 *
 * ## Con qué rol se prueba, y por qué importa
 *
 * Con el rol de aplicación **sin `BYPASSRLS`**, y —esto es lo que cambia
 * respecto de la primera versión de la feature— ese rol **no lo crea este
 * test**: lo provisiona `asegurarRolDeAplicacion`, el mismo procedimiento que
 * usará la aplicación en producción (R46, R57). Un test que se fabrica su
 * propio sujeto es verde por construcción: es exactamente el defecto B2 que
 * hundió la primera entrega, y el guard `tests/ddl-en-tests.test.ts` existe
 * para que no vuelva a colarse.
 *
 * El usuario por defecto del contenedor es superusuario y se saltaría el RLS
 * entero, así que los datos se siembran con él —eso es legítimo, es el estímulo—
 * y **todas las afirmaciones** se hacen con el rol sujeto a RLS.
 *
 * ## Qué se afirma
 *
 * Que la política estándar de R49 (`USING` **y** `WITH CHECK` sobre
 * `tenant_id`) hace lo que dice en los cuatro comandos, que la unicidad del
 * correo es por inmobiliaria (R59) y que la FK compuesta impide que un rol viva
 * en un tenant distinto al de su identidad (R60).
 */
describe('Identidad por inmobiliaria — RLS real (#5 R49, R59, R60, D-8)', () => {
  let contenedor: StartedPostgreSqlContainer;
  let poolAdmin: Pool;
  let poolApp: Pool;

  const carpetaMigraciones = resolveMigrationsFolder(__dirname);

  const USUARIO_APP = 'app_inmobiliaria';
  /** Literal de test, no una credencial (CHECKPOINTS.md §C7). */
  const CLAVE_APP = 'clave-inerte-de-test';

  const TENANT_A = '11111111-1111-1111-1111-111111111111';
  const TENANT_B = '22222222-2222-2222-2222-222222222222';
  const USER_A = 'aaaaaaaa-0000-0000-0000-00000000000a';
  const USER_B = 'bbbbbbbb-0000-0000-0000-00000000000b';

  /** Ejecuta `fn` con el rol de aplicación y el tenant fijado. */
  async function comoTenant<T>(
    tenantId: string | null,
    fn: (cliente: PoolClient) => Promise<T>,
  ): Promise<T> {
    const cliente = await poolApp.connect();
    try {
      await cliente.query('BEGIN');
      if (tenantId !== null) {
        await cliente.query('SELECT set_config($1, $2, true)', [
          'app.current_tenant',
          tenantId,
        ]);
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
      usuario: USUARIO_APP,
      clave: CLAVE_APP,
    });

    // Conexión con el rol de aplicación de verdad, no un `SET ROLE`: así el
    // test mide lo mismo que medirá la aplicación.
    const url = new URL(connectionString);
    url.username = USUARIO_APP;
    url.password = CLAVE_APP;
    poolApp = new Pool({ connectionString: url.toString() });

    await poolAdmin.query(
      `INSERT INTO tenant (id, nombre, nit, codigo)
       VALUES ($1, 'Inmobiliaria A', '900111', 'inmobiliaria-a'),
              ($2, 'Inmobiliaria B', '900222', 'inmobiliaria-b')`,
      [TENANT_A, TENANT_B],
    );
    await poolAdmin.query(
      `INSERT INTO "user" (id, tenant_id, email, password_hash, nombre)
       VALUES ($1, $3, 'persona@example.com', NULL, 'Persona En A'),
              ($2, $4, 'persona@example.com', NULL, 'Persona En B')`,
      [USER_A, USER_B, TENANT_A, TENANT_B],
    );
    await poolAdmin.query(
      `INSERT INTO user_role (user_id, tenant_id, rol)
       VALUES ($1, $2, 'propietario'), ($3, $4, 'propietario')`,
      [USER_A, TENANT_A, USER_B, TENANT_B],
    );
  }, 180_000);

  afterAll(async () => {
    await poolApp?.end();
    await poolAdmin?.end();
    await contenedor?.stop();
  });

  // ─── El rol con el que se prueba es el correcto ──────────────────────────

  it('el rol de la conexión NO es superusuario ni tiene BYPASSRLS', async () => {
    // Si esto fallase, todo lo demás de este archivo sería un verde vacío.
    const roles = await comoTenant(TENANT_A, async (c) => {
      const { rows } = await c.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
        'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
      );
      return rows;
    });

    expect(roles).toHaveLength(1);
    expect(roles[0]?.rolsuper).toBe(false);
    expect(roles[0]?.rolbypassrls).toBe(false);
  });

  it('el rol de la conexión NO es dueño de `user` (R43)', async () => {
    const { rows } = await poolAdmin.query<{ propietario: string }>(
      `SELECT tableowner AS propietario FROM pg_tables
        WHERE schemaname = 'public' AND tablename = 'user'`,
    );
    expect(rows[0]?.propietario).not.toBe(USUARIO_APP);
  });

  // ─── R49 — la política estándar, comando por comando ─────────────────────

  describe('política estándar de `user` (R49)', () => {
    it('SELECT devuelve solo las identidades del tenant activo', async () => {
      const filas = await comoTenant(TENANT_A, async (c) => {
        const { rows } = await c.query<{ id: string; tenant_id: string }>(
          'SELECT id, tenant_id FROM "user"',
        );
        return rows;
      });

      expect(filas.length).toBeGreaterThan(0);
      expect(filas.every((f) => f.tenant_id === TENANT_A)).toBe(true);
      expect(filas.map((f) => f.id)).not.toContain(USER_B);
    });

    it('INSERT con el tenant_id propio está permitido (R55)', async () => {
      const afectadas = await comoTenant(TENANT_A, async (c) => {
        const { rowCount } = await c.query(
          `INSERT INTO "user" (tenant_id, email, password_hash, nombre)
           VALUES ($1, 'nueva-en-a@example.com', NULL, 'Nueva En A')`,
          [TENANT_A],
        );
        return rowCount;
      });

      // Con la política anterior (`FOR ALL` sin `WITH CHECK`) esto era
      // imposible: el `WITH CHECK` heredado exigía un `user_role` que aún no
      // podía existir. Ese bloqueo circular es el que D-8 elimina.
      expect(afectadas).toBe(1);
    });

    it('INSERT con el tenant_id de OTRA inmobiliaria lo rechaza el motor', async () => {
      await expect(
        comoTenant(TENANT_A, (c) =>
          c.query(
            `INSERT INTO "user" (tenant_id, email, password_hash, nombre)
             VALUES ($1, 'colada-en-b@example.com', NULL, 'Colada En B')`,
            [TENANT_B],
          ),
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it('UPDATE de una fila ajena no afecta ninguna fila, y nada cambia', async () => {
      const afectadas = await comoTenant(TENANT_A, async (c) => {
        const { rowCount } = await c.query(
          `UPDATE "user" SET nombre = 'Reescrita' WHERE id = $1`,
          [USER_B],
        );
        return rowCount;
      });
      expect(afectadas).toBe(0);

      // Verificación independiente con el pool privilegiado.
      const { rows } = await poolAdmin.query<{ nombre: string }>(
        'SELECT nombre FROM "user" WHERE id = $1',
        [USER_B],
      );
      expect(rows[0]?.nombre).toBe('Persona En B');
    });

    it('UPDATE que intenta MUDAR una fila propia a otro tenant lo rechaza el WITH CHECK', async () => {
      // Este es el caso que la política anterior no cubría: `USING` deja tocar
      // la fila (es mía) y sin `WITH CHECK` el resultado podía quedar en otra
      // inmobiliaria. Es el agujero que R49 cierra de forma explícita.
      await expect(
        comoTenant(TENANT_A, (c) =>
          c.query(`UPDATE "user" SET tenant_id = $1 WHERE id = $2`, [TENANT_B, USER_A]),
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it('DELETE está denegado por privilegio, no solo por política (R45)', async () => {
      // La identidad no se borra (`docs/conventions.md`). El rol de aplicación
      // no tiene el privilegio, así que el motor rechaza la sentencia entera
      // en vez de "borrar 0 filas" en silencio.
      await expect(
        comoTenant(TENANT_A, (c) => c.query('DELETE FROM "user" WHERE id = $1', [USER_A])),
      ).rejects.toThrow(/permission denied|permiso denegado/i);
    });

    it('sin contexto de tenant no se ve ninguna identidad (R34)', async () => {
      const poolVirgen = new Pool({
        connectionString: (() => {
          const url = new URL(contenedor.getConnectionUri());
          url.username = USUARIO_APP;
          url.password = CLAVE_APP;
          return url.toString();
        })(),
        max: 1,
      });
      try {
        const { rows } = await poolVirgen.query('SELECT * FROM "user"');
        expect(rows).toHaveLength(0);
      } finally {
        await poolVirgen.end();
      }
    });
  });

  // ─── R59 — unicidad del correo por inmobiliaria ──────────────────────────

  describe('unicidad del correo por inmobiliaria (R59)', () => {
    it('el mismo correo convive en dos inmobiliarias', async () => {
      // Ya sembrado en `beforeAll`: dos personas distintas, mismo correo. Antes
      // de D-8 la `UNIQUE(email)` global lo hacía imposible, y es la razón por
      // la que el login tiene que pedir el `codigo` (R63, R65).
      const { rows } = await poolAdmin.query<{ tenant_id: string }>(
        `SELECT tenant_id::text FROM "user" WHERE email = 'persona@example.com' ORDER BY tenant_id`,
      );
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.tenant_id)).toEqual([TENANT_A, TENANT_B]);
    });

    it('repetirlo DENTRO de la misma inmobiliaria da 23505', async () => {
      await expect(
        comoTenant(TENANT_A, (c) =>
          c.query(
            `INSERT INTO "user" (tenant_id, email, password_hash, nombre)
             VALUES ($1, 'persona@example.com', NULL, 'Duplicada En A')`,
            [TENANT_A],
          ),
        ),
      ).rejects.toMatchObject({ code: '23505' });
    });

    it('varias identidades sin correo conviven en la misma inmobiliaria (D-5, R7)', async () => {
      const afectadas = await comoTenant(TENANT_A, async (c) => {
        await c.query(
          `INSERT INTO "user" (tenant_id, email, password_hash, nombre)
           VALUES ($1, NULL, NULL, 'Sin correo 1')`,
          [TENANT_A],
        );
        const { rowCount } = await c.query(
          `INSERT INTO "user" (tenant_id, email, password_hash, nombre)
           VALUES ($1, NULL, NULL, 'Sin correo 2')`,
          [TENANT_A],
        );
        return rowCount;
      });

      expect(afectadas).toBe(1);
    });
  });

  // ─── R60 — el rol no puede apuntar a otro tenant que su identidad ────────

  describe('coherencia entre identidad y rol (R60)', () => {
    it('la FK compuesta impide un user_role en otra inmobiliaria', async () => {
      // `23503` = foreign_key_violation. Se intenta con el pool PRIVILEGIADO a
      // propósito: una FK no es una política, así que ni el superusuario puede
      // saltársela. Sin esto, bastaría un INSERT con el tenant equivocado para
      // reintroducir la identidad compartida por la puerta de atrás.
      await expect(
        poolAdmin.query(
          `INSERT INTO user_role (user_id, tenant_id, rol) VALUES ($1, $2, 'admin')`,
          [USER_A, TENANT_B],
        ),
      ).rejects.toMatchObject({ code: '23503' });
    });

    it('el rol en la inmobiliaria propia sí se inserta', async () => {
      const { rowCount } = await poolAdmin.query(
        `INSERT INTO user_role (user_id, tenant_id, rol) VALUES ($1, $2, 'inquilino')`,
        [USER_A, TENANT_A],
      );
      expect(rowCount).toBe(1);
    });

    it('la identidad no puede mudarse de inmobiliaria dejando sus roles atrás', async () => {
      // Se usa una inmobiliaria TERCERA para que el rechazo sea inequívocamente
      // el de la FK compuesta (`23503`) y no el de la unicidad del correo, que
      // en el tenant B saltaría antes por otro motivo.
      const TENANT_C = '33333333-3333-3333-3333-333333333333';
      await poolAdmin.query(
        `INSERT INTO tenant (id, nombre, nit, codigo)
         VALUES ($1, 'Inmobiliaria C', '900333', 'inmobiliaria-c')
         ON CONFLICT (id) DO NOTHING`,
        [TENANT_C],
      );

      await expect(
        poolAdmin.query(`UPDATE "user" SET tenant_id = $1 WHERE id = $2`, [
          TENANT_C,
          USER_A,
        ]),
      ).rejects.toMatchObject({ code: '23503' });
    });
  });
});
