import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ConfigurationError } from '../../common/errors';
import { resolveMigrationsFolder } from '../../../src/database/migrations-folder';
import { asegurarRolDeAplicacion } from '../../../src/database/rol-aplicacion';
import { runMigrations } from '../../../src/database/run-migrations';
import { exigirRolSujetoARls } from '../verificar-rol-de-aplicacion';
import {
  CLAVE_APP_DE_PRUEBA,
  USUARIO_APP_DE_PRUEBA,
} from '../../../test/support/entorno-clientes';

/**
 * **T64 — R43, R44, R45**: el rol con el que corre la aplicación está
 * realmente sujeto al RLS y tiene los privilegios mínimos.
 *
 * ## Por qué esto se afirma contra la base y no leyendo el código
 *
 * El hallazgo **B3** no era un error de programación: era una **cadena de
 * conexión**. El código de las políticas era correcto, los tests de RLS pasaban
 * y aun así el aislamiento no lo aplicaba nadie en ejecución, porque la
 * aplicación se conectaba como superusuario. Ninguna revisión de código lo
 * habría visto. Lo único que lo ve es preguntárselo al motor, que es lo que
 * hace este archivo.
 *
 * El rol lo crea `asegurarRolDeAplicacion`, **el mismo procedimiento que usa
 * `npm run db:migrate`** (R46). Si aquí se creara uno a medida, el test volvería
 * a ser verde por construcción y no diría nada del rol real.
 */
describe('Rol de aplicación sujeto a RLS (#5 R43, R44, R45, B3)', () => {
  let contenedor: StartedPostgreSqlContainer;
  let pool: Pool;
  let connectionString: string;

  beforeAll(async () => {
    contenedor = await new PostgreSqlContainer('postgres:16.4-alpine').start();
    connectionString = contenedor.getConnectionUri();
    pool = new Pool({ connectionString });

    await runMigrations(connectionString, resolveMigrationsFolder(__dirname));
    await asegurarRolDeAplicacion(connectionString, {
      usuario: USUARIO_APP_DE_PRUEBA,
      clave: CLAVE_APP_DE_PRUEBA,
    });
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await contenedor?.stop();
  });

  // ─── R43 — atributos del rol ─────────────────────────────────────────────

  it('NO es superusuario, NO tiene BYPASSRLS y no puede crear roles ni bases', async () => {
    const { rows } = await pool.query<{
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      rolcanlogin: boolean;
    }>(
      `SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolcanlogin
         FROM pg_roles WHERE rolname = $1`,
      [USUARIO_APP_DE_PRUEBA],
    );

    expect(rows).toHaveLength(1);
    // Las dos primeras son LA razón de ser de este rol: con cualquiera de ellas
    // en `true`, `FORCE ROW LEVEL SECURITY` no le aplica y todas las políticas
    // del proyecto se vuelven decorativas.
    expect(rows[0]?.rolsuper).toBe(false);
    expect(rows[0]?.rolbypassrls).toBe(false);
    expect(rows[0]?.rolcreatedb).toBe(false);
    expect(rows[0]?.rolcreaterole).toBe(false);
    expect(rows[0]?.rolcanlogin).toBe(true);
  });

  it('NO es dueño de ninguna tabla (R43)', async () => {
    // `FORCE ROW LEVEL SECURITY` alcanza al dueño; que el rol no lo sea es lo
    // que hace que las políticas se le apliquen de verdad.
    const { rows } = await pool.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tableowner = $1`,
      [USUARIO_APP_DE_PRUEBA],
    );

    expect(rows.map((r) => r.tablename)).toEqual([]);
  });

  // ─── R45 — privilegios mínimos ───────────────────────────────────────────

  describe('privilegios mínimos (R45)', () => {
    async function tablasDeNegocio(): Promise<string[]> {
      const { rows } = await pool.query<{ tablename: string }>(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
      );
      return rows.map((r) => r.tablename);
    }

    it('NO tiene privilegio DELETE en NINGUNA tabla', async () => {
      const tablas = await tablasDeNegocio();
      expect(tablas.length).toBeGreaterThan(0);

      const conDelete: string[] = [];
      for (const tabla of tablas) {
        const { rows } = await pool.query<{ puede: boolean }>(
          'SELECT has_table_privilege($1, $2, $3) AS puede',
          [USUARIO_APP_DE_PRUEBA, `public.${tabla}`, 'DELETE'],
        );
        if (rows[0]?.puede) conDelete.push(tabla);
      }

      // Todas las bajas son lógicas (R14, R21) y las entidades con valor legal
      // son inmutables. Negar el DELETE en el motor convierte esa convención en
      // una barrera: un `DELETE` por error no borra, falla.
      expect(conDelete).toEqual([]);
    });

    it('NO puede hacer UPDATE ni DELETE sobre audit_log (R41, R45)', async () => {
      for (const privilegio of ['UPDATE', 'DELETE']) {
        const { rows } = await pool.query<{ puede: boolean }>(
          'SELECT has_table_privilege($1, $2, $3) AS puede',
          [USUARIO_APP_DE_PRUEBA, 'public.audit_log', privilegio],
        );
        expect(rows[0]?.puede, `audit_log ${privilegio}`).toBe(false);
      }
    });

    it('SÍ puede leer e insertar en audit_log', async () => {
      for (const privilegio of ['SELECT', 'INSERT']) {
        const { rows } = await pool.query<{ puede: boolean }>(
          'SELECT has_table_privilege($1, $2, $3) AS puede',
          [USUARIO_APP_DE_PRUEBA, 'public.audit_log', privilegio],
        );
        expect(rows[0]?.puede, `audit_log ${privilegio}`).toBe(true);
      }
    });

    it('SÍ puede leer, insertar y actualizar las tablas de negocio', async () => {
      for (const tabla of ['perfil_propietario', 'perfil_inquilino', 'cuenta_bancaria', 'user']) {
        for (const privilegio of ['SELECT', 'INSERT', 'UPDATE']) {
          const { rows } = await pool.query<{ puede: boolean }>(
            'SELECT has_table_privilege($1, $2, $3) AS puede',
            [USUARIO_APP_DE_PRUEBA, `public."${tabla}"`, privilegio],
          );
          expect(rows[0]?.puede, `${tabla} ${privilegio}`).toBe(true);
        }
      }
    });

    it('puede ejecutar tenant_por_codigo, la única ruta previa al tenant (R52)', async () => {
      const { rows } = await pool.query<{ puede: boolean }>(
        `SELECT has_function_privilege($1, 'tenant_por_codigo(text)', 'EXECUTE') AS puede`,
        [USUARIO_APP_DE_PRUEBA],
      );
      expect(rows[0]?.puede).toBe(true);
    });
  });

  // ─── R46 — la provisión es idempotente ───────────────────────────────────

  it('reprovisionar no acumula privilegios ni falla (R46)', async () => {
    await asegurarRolDeAplicacion(connectionString, {
      usuario: USUARIO_APP_DE_PRUEBA,
      clave: CLAVE_APP_DE_PRUEBA,
    });

    const { rows } = await pool.query<{ puede: boolean }>(
      `SELECT has_table_privilege($1, 'public.perfil_propietario', 'DELETE') AS puede`,
      [USUARIO_APP_DE_PRUEBA],
    );
    expect(rows[0]?.puede).toBe(false);
  });

  // ─── R44 — el fail-fast de arranque ──────────────────────────────────────

  describe('fail-fast de arranque (R44)', () => {
    it('aborta con ConfigurationError si el rol es superusuario', () => {
      let capturado: unknown;
      try {
        exigirRolSujetoARls({ rolsuper: true, rolbypassrls: false }, 'postgres');
      } catch (error) {
        capturado = error;
      }

      expect(capturado).toBeInstanceOf(ConfigurationError);
      expect((capturado as ConfigurationError).variables).toContain('DATABASE_URL');
      // Accionable: dice qué hacer, no solo que algo va mal.
      expect((capturado as ConfigurationError).message).toMatch(/APP_DB_USER/);
      expect((capturado as ConfigurationError).message).toMatch(/db:migrate/);
    });

    it('aborta también si el rol tiene BYPASSRLS sin ser superusuario', () => {
      expect(() =>
        exigirRolSujetoARls({ rolsuper: false, rolbypassrls: true }, 'colado'),
      ).toThrow(ConfigurationError);
    });

    it('aborta si no se pudo determinar el privilegio del rol', () => {
      // Sin certeza no se arranca: "no lo sé" no puede tratarse como "está bien".
      expect(() => exigirRolSujetoARls(undefined, 'desconocido')).toThrow(
        ConfigurationError,
      );
    });

    it('deja pasar al rol de aplicación real', async () => {
      const { rows } = await pool.query<{
        rolsuper: boolean;
        rolbypassrls: boolean;
      }>('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1', [
        USUARIO_APP_DE_PRUEBA,
      ]);

      // No es un caso inventado: son los privilegios que el procedimiento de
      // provisión acaba de dejar en la base.
      expect(() =>
        exigirRolSujetoARls(rows[0], USUARIO_APP_DE_PRUEBA),
      ).not.toThrow();
    });
  });
});
