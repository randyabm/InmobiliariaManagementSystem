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
 * **T7 — R14, R22, R24**: la política `user_tenant_isolation` que ya existía
 * cubre las columnas nuevas de `0009`, y buscar por **documento** no es una
 * puerta trasera para alcanzar identidades de otra inmobiliaria.
 *
 * ## Por qué hace falta un test y no basta el razonamiento
 *
 * El razonamiento es correcto —una política de PostgreSQL se evalúa por fila,
 * no por columna, así que `documento` queda cubierta sin escribir nada nuevo—,
 * pero esta feature introduce **una consulta que antes no existía**:
 * `WHERE tipo_documento = $1 AND documento = $2`. Es justo la forma de consulta
 * que D-8 prohíbe que alcance fuera del tenant, y "se deduce de la política" es
 * lo que se dijo de otras cosas que luego resultaron falsas. Se mide.
 *
 * ## Con qué rol
 *
 * Con el **rol de aplicación sin `BYPASSRLS`**, provisionado por
 * `asegurarRolDeAplicacion` —el mismo procedimiento que usa `db:migrate` en
 * producción—, nunca por este archivo (R24, `tests/ddl-en-tests.test.ts`). El
 * usuario del contenedor es superusuario: se usa **solo** para sembrar, que es
 * el estímulo, jamás para afirmar.
 */
describe('Deduplicación por documento y RLS real (#26 R14, R22, R24)', () => {
  let contenedor: StartedPostgreSqlContainer;
  let poolAdmin: Pool;
  let poolApp: Pool;

  const carpetaMigraciones = resolveMigrationsFolder(__dirname);

  const USUARIO_APP = 'app_inmobiliaria';
  /** Literal de test, no una credencial (CHECKPOINTS.md §C7). */
  const CLAVE_APP = 'clave-inerte-de-test';

  const TENANT_A = '11111111-1111-1111-1111-111111111111';
  const TENANT_B = '22222222-2222-2222-2222-222222222222';
  const USER_A = 'aaaaaaaa-0000-0000-0000-0000000000da';
  const USER_B = 'bbbbbbbb-0000-0000-0000-0000000000db';

  /** El MISMO documento en las dos inmobiliarias: la misma persona física. */
  const DOCUMENTO = '52000123';

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
    // La misma persona física, dos identidades: una por inmobiliaria. Eso es
    // lo que D-8 exige, y es el escenario en el que la deduplicación de R1/R2
    // podría convertirse en una fuga si buscara sin acotar.
    await poolAdmin.query(
      `INSERT INTO "user" (id, tenant_id, nombre, tipo_documento, documento)
       VALUES ($1, $3, 'María Pérez', 'CC', $5),
              ($2, $4, 'María Pérez', 'CC', $5)`,
      [USER_A, USER_B, TENANT_A, TENANT_B, DOCUMENTO],
    );
  }, 180_000);

  afterAll(async () => {
    await poolApp?.end();
    await poolAdmin?.end();
    await contenedor?.stop();
  });

  it('el rol de la conexión NO es superusuario ni tiene BYPASSRLS (R24)', async () => {
    // Si esto fallase, todo lo demás de este archivo sería un verde vacío.
    const { rows } = await poolApp.query<{
      usename: string;
      usesuper: boolean;
      usebypassrls: boolean;
    }>(
      'SELECT usename, usesuper, usebypassrls FROM pg_user WHERE usename = current_user',
    );

    expect(rows[0]?.usename).toBe(USUARIO_APP);
    expect(rows[0]?.usesuper).toBe(false);
    expect(rows[0]?.usebypassrls).toBe(false);
  });

  it('la política `user_tenant_isolation` sigue vigente y forzada', async () => {
    // La migración 0009 no crea política alguna: se apoya en la de 0007. Si
    // alguien la retirara, esta feature perdería su aislamiento en silencio.
    const { rows } = await poolAdmin.query<{
      polname: string;
      relforcerowsecurity: boolean;
    }>(
      `SELECT p.polname, c.relforcerowsecurity
         FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
        WHERE c.relname = 'user'`,
    );

    expect(rows.map((r) => r.polname)).toEqual(['user_tenant_isolation']);
    expect(rows[0]?.relforcerowsecurity).toBe(true);
  });

  describe('Buscar por documento no alcanza otra inmobiliaria (R14, R22)', () => {
    it('desde A, la consulta por documento devuelve SOLO la identidad de A', async () => {
      // Consulta cruda, sin `WHERE tenant_id`: quien filtra aquí es el motor.
      const filas = await comoTenant(TENANT_A, async (cliente) => {
        const { rows } = await cliente.query<{ id: string; tenant_id: string }>(
          'SELECT id, tenant_id FROM "user" WHERE tipo_documento = $1 AND documento = $2',
          ['CC', DOCUMENTO],
        );
        return rows;
      });

      expect(filas).toHaveLength(1);
      expect(filas[0]?.id).toBe(USER_A);
      expect(filas[0]?.tenant_id).toBe(TENANT_A);
    });

    it('desde B, la misma consulta devuelve SOLO la identidad de B', async () => {
      const filas = await comoTenant(TENANT_B, async (cliente) => {
        const { rows } = await cliente.query<{ id: string }>(
          'SELECT id FROM "user" WHERE tipo_documento = $1 AND documento = $2',
          ['CC', DOCUMENTO],
        );
        return rows;
      });

      expect(filas.map((f) => f.id)).toEqual([USER_B]);
    });

    it('ni siquiera un COUNT revela que ese documento existe en otra parte', async () => {
      // Un conteo es la fuga más barata: "esa persona ya es cliente de alguien"
      // es exactamente lo que prohíbe el PRD §11.3.
      const total = await comoTenant(TENANT_A, async (cliente) => {
        const { rows } = await cliente.query<{ total: string }>(
          'SELECT count(*)::text AS total FROM "user" WHERE documento = $1',
          [DOCUMENTO],
        );
        return Number(rows[0]?.total);
      });

      expect(total).toBe(1);
    });

    it('sin contexto de tenant la consulta no devuelve datos: falla', async () => {
      // El predicado de la política castea `app.current_tenant` a uuid y sin
      // contexto ese ajuste es la cadena vacía, así que PostgreSQL aborta con
      // `22P02`. Se afirma el fallo, no una lista vacía: lo que importa —y lo
      // único que este test promete— es que **ninguna fila sale**. Fallar en
      // vez de devolver cero es incluso preferible: un olvido de fijar el
      // tenant se ve, en lugar de parecer "no hay datos".
      await expect(
        comoTenant(null, (cliente) =>
          cliente.query('SELECT id FROM "user" WHERE documento = $1', [
            DOCUMENTO,
          ]),
        ),
      ).rejects.toMatchObject({ code: '22P02' });
    });
  });

  describe('Escribir el documento tampoco cruza la frontera (R22)', () => {
    it('no se puede escribir el documento de una identidad de otro tenant', async () => {
      const afectadas = await comoTenant(TENANT_A, async (cliente) => {
        const resultado = await cliente.query(
          'UPDATE "user" SET documento = $1 WHERE id = $2',
          ['99999999', USER_B],
        );
        return resultado.rowCount;
      });

      // 0 filas, no un error: la fila de B sencillamente no existe para A.
      expect(afectadas).toBe(0);
    });

    it('no se puede crear una identidad con documento en otro tenant (WITH CHECK)', async () => {
      await expect(
        comoTenant(TENANT_A, (cliente) =>
          cliente.query(
            `INSERT INTO "user" (tenant_id, nombre, tipo_documento, documento)
             VALUES ($1, 'Colada', 'CC', '77000001')`,
            [TENANT_B],
          ),
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });

    it('dentro del propio tenant, el documento sí se puede leer y escribir', async () => {
      // El aislamiento no puede ser "no funciona nada": la deduplicación de
      // R1/R2 necesita justamente esta consulta.
      const encontrado = await comoTenant(TENANT_A, async (cliente) => {
        await cliente.query(
          `INSERT INTO "user" (tenant_id, nombre, tipo_documento, documento)
           VALUES ($1, 'Nueva En A', 'CC', '77000002')`,
          [TENANT_A],
        );
        const { rows } = await cliente.query<{ nombre: string }>(
          'SELECT nombre FROM "user" WHERE tipo_documento = $1 AND documento = $2',
          ['CC', '77000002'],
        );
        return rows[0]?.nombre;
      });

      expect(encontrado).toBe('Nueva En A');
    });
  });
});
