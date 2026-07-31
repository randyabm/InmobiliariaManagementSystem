import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type EntornoClientes,
  levantarEntornoClientes,
  TENANT_A,
  TENANT_B,
} from '../../../../../test/support/entorno-clientes';

/**
 * **T65 — R38, R48, R58**: re-verificación de §C7 con el rol de aplicación real.
 *
 * ## Qué añade este archivo sobre `seguridad.api.test.ts`
 *
 * Aquel prueba lo mismo —accesos cruzados que devuelven 404— y **pasaba también
 * antes de esta corrección**. Ese es justamente el problema que señaló la
 * revisión (**B3**): la aplicación se conectaba como superusuario, así que
 * `FORCE ROW LEVEL SECURITY` no le aplicaba y aquellos 404 medían el
 * `WHERE tenant_id` del repositorio, no el motor. Un test verde sobre un
 * invariante que en producción no se cumplía.
 *
 * Ahora la app corre con el rol sujeto a RLS (T61, T63), y este archivo lo
 * comprueba **de la única forma que distingue las dos cosas**: lanzando por la
 * conexión de la aplicación una consulta **cruda, sin `WHERE tenant_id`**. Si
 * el motor no estuviera filtrando, devolvería las filas de las dos
 * inmobiliarias; el repositorio no interviene aquí, porque no hay repositorio.
 *
 * Cierra también, con el rol real, el caso de escritura cruzada sobre `user`
 * de T52 (**R38**).
 */
describe('§C7 con el rol de aplicación real (#5 R38, R48, R58, B3)', () => {
  let entorno: EntornoClientes;

  let propietarioA = '';
  let propietarioB = '';
  let inquilinoB = '';
  let cuentaB = '';

  beforeAll(async () => {
    entorno = await levantarEntornoClientes();
    const servidor = entorno.app.getHttpServer();

    const crear = async (token: string, tenantId: string, sufijo: string) => {
      const prop = await request(servidor)
        .post('/propietarios')
        .set('Authorization', `Bearer ${token}`)
        .set('x-tenant-id', tenantId)
        .send({ nombre: `Prop ${sufijo}`, tipo_documento: 'CC', documento: `C7-${sufijo}` })
        .expect(201);

      const cuenta = await request(servidor)
        .post(`/propietarios/${prop.body.id}/cuentas-bancarias`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-tenant-id', tenantId)
        .send({
          banco: 'Bancolombia',
          tipo_cuenta: 'AHORROS',
          numero_cuenta: `C7-NC-${sufijo}`,
          titular_nombre: `Prop ${sufijo}`,
          titular_tipo_documento: 'CC',
          titular_documento: `C7-${sufijo}`,
        })
        .expect(201);

      const inq = await request(servidor)
        .post('/inquilinos')
        .set('Authorization', `Bearer ${token}`)
        .set('x-tenant-id', tenantId)
        .send({
          nombre: `Inq ${sufijo}`,
          tipo_documento: 'CC',
          documento: `C7-I-${sufijo}`,
          email: `c7-inq-${sufijo}@example.com`,
          celular: '3009998877',
          medio_preferido_contacto: 'SMS',
        })
        .expect(201);

      return { prop: prop.body.id, cuenta: cuenta.body.id, inq: inq.body.id };
    };

    const enA = await crear(entorno.adminA.token, TENANT_A, 'A');
    const enB = await crear(entorno.adminB.token, TENANT_B, 'B');
    propietarioA = enA.prop;
    propietarioB = enB.prop;
    inquilinoB = enB.inq;
    cuentaB = enB.cuenta;
  }, 180_000);

  afterAll(async () => {
    await entorno?.cerrar();
  });

  const servidor = () => entorno.app.getHttpServer();

  /** Ejecuta `fn` con la conexión de la app y el tenant fijado. */
  async function comoLaApp<T>(
    tenantId: string,
    fn: (cliente: import('pg').PoolClient) => Promise<T>,
  ): Promise<T> {
    const cliente = await entorno.poolApp.connect();
    try {
      await cliente.query('BEGIN');
      await cliente.query('SELECT set_config($1, $2, true)', [
        'app.current_tenant',
        tenantId,
      ]);
      return await fn(cliente);
    } finally {
      await cliente.query('ROLLBACK').catch(() => undefined);
      cliente.release();
    }
  }

  // ─── El rol es el correcto (si no, todo lo demás no dice nada) ───────────

  it('la conexión de la aplicación NO es superusuario ni tiene BYPASSRLS (R48)', async () => {
    const { rows } = await entorno.poolApp.query<{
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user');

    expect(rows).toHaveLength(1);
    expect(rows[0]?.rolsuper).toBe(false);
    expect(rows[0]?.rolbypassrls).toBe(false);
  });

  it('la app y esta conexión usan el MISMO rol', async () => {
    // Sin esto, el test podría estar midiendo un rol distinto del que sirve las
    // peticiones HTTP, que es exactamente el error de forma de B3.
    const { rows } = await entorno.poolApp.query<{ usuario: string }>(
      'SELECT current_user AS usuario',
    );
    expect(process.env.DATABASE_URL).toContain(rows[0]!.usuario);
  });

  // ─── R58 — el motor filtra, no el repositorio ───────────────────────────

  describe('lo que filtra es el motor (R58)', () => {
    const TABLAS = ['perfil_propietario', 'perfil_inquilino', 'cuenta_bancaria'] as const;

    it.each(TABLAS)(
      'un SELECT * SIN WHERE sobre %s por la conexión de la app devuelve solo el tenant activo',
      async (tabla) => {
        // No hay `WHERE tenant_id` en ninguna parte de esta consulta: quien
        // filtra o es PostgreSQL, o no filtra nadie.
        const consulta = `SELECT * FROM ${tabla}`;
        expect(consulta).not.toMatch(/tenant_id/);

        const enA = await comoLaApp(TENANT_A, async (c) => {
          const { rows } = await c.query<{ tenant_id: string }>(consulta);
          return rows;
        });
        expect(enA.length).toBeGreaterThan(0);
        expect(enA.every((f) => f.tenant_id === TENANT_A)).toBe(true);

        const enB = await comoLaApp(TENANT_B, async (c) => {
          const { rows } = await c.query<{ tenant_id: string }>(consulta);
          return rows;
        });
        expect(enB.length).toBeGreaterThan(0);
        expect(enB.every((f) => f.tenant_id === TENANT_B)).toBe(true);

        // Y las dos inmobiliarias tienen datos de verdad: si una estuviera
        // vacía, "solo veo los míos" sería trivialmente cierto.
        const { rows: total } = await entorno.poolAdmin.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM ${tabla}`,
        );
        expect(Number(total[0]!.n)).toBe(enA.length + enB.length);
      },
    );

    it('la tabla de identidades también la filtra el motor (R49)', async () => {
      const enA = await comoLaApp(TENANT_A, async (c) => {
        const { rows } = await c.query<{ tenant_id: string }>('SELECT * FROM "user"');
        return rows;
      });

      expect(enA.length).toBeGreaterThan(0);
      expect(enA.every((f) => f.tenant_id === TENANT_A)).toBe(true);
    });

    it('sin contexto de tenant, la conexión de la app no ve NADA (R34)', async () => {
      // Pool NUEVO a propósito: `current_setting('app.current_tenant', true)`
      // solo devuelve NULL si el GUC no se fijó nunca en esa sesión. Una
      // conexión reciclada del pool conserva el GUC con valor vacío, y ese es
      // el otro caso —la consulta aborta con 22P02—, cubierto en
      // `clientes-rls.test.ts`. Los dos son "no ve nada"; aquí se prueba el
      // primero, que es el que podría devolver filas si la política estuviera
      // mal escrita.
      const { Pool } = await import('pg');
      const poolVirgen = new Pool({ connectionString: entorno.urlApp, max: 1 });
      try {
        const { rows } = await poolVirgen.query('SELECT * FROM perfil_propietario');
        expect(rows).toHaveLength(0);
      } finally {
        await poolVirgen.end();
      }
    });

    it('el rol de la app no puede BORRAR ni con el tenant correcto (R45)', async () => {
      await expect(
        comoLaApp(TENANT_A, (c) =>
          c.query('DELETE FROM perfil_propietario WHERE id = $1', [propietarioA]),
        ),
      ).rejects.toThrow(/permission denied|permiso denegado/i);
    });
  });

  // ─── R31 — los nueve accesos cruzados, ahora con el rol real ────────────

  it('los 9 accesos cruzados siguen devolviendo 404 con el rol sujeto a RLS (R31)', async () => {
    const casos = [
      ['GET propietario ajeno', 'get', `/propietarios/${propietarioB}`, undefined],
      ['PATCH propietario ajeno', 'patch', `/propietarios/${propietarioB}`, { ciudad: 'Robada' }],
      ['DELETE propietario ajeno', 'delete', `/propietarios/${propietarioB}`, undefined],
      ['GET inquilino ajeno', 'get', `/inquilinos/${inquilinoB}`, undefined],
      ['PATCH inquilino ajeno', 'patch', `/inquilinos/${inquilinoB}`, { celular: '3000000000' }],
      ['DELETE inquilino ajeno', 'delete', `/inquilinos/${inquilinoB}`, undefined],
      ['GET cuentas ajenas', 'get', `/propietarios/${propietarioB}/cuentas-bancarias`, undefined],
      [
        'POST cuenta a propietario ajeno',
        'post',
        `/propietarios/${propietarioB}/cuentas-bancarias`,
        {
          banco: 'Banco Intruso',
          tipo_cuenta: 'AHORROS',
          numero_cuenta: '000',
          titular_nombre: 'Intruso',
          titular_tipo_documento: 'CC',
          titular_documento: '000',
        },
      ],
      [
        'PATCH cuenta ajena',
        'patch',
        `/propietarios/${propietarioB}/cuentas-bancarias/${cuentaB}`,
        { es_predeterminada: true },
      ],
    ] as const;

    const resultados: Array<[string, number]> = [];
    for (const [nombre, metodo, ruta, cuerpo] of casos) {
      const peticion = request(servidor())
        [metodo](ruta)
        .set('Authorization', `Bearer ${entorno.adminA.token}`)
        .set('x-tenant-id', TENANT_A);
      const respuesta = cuerpo ? await peticion.send(cuerpo) : await peticion;
      resultados.push([nombre, respuesta.status]);
    }

    expect(resultados).toEqual(resultados.map(([n]) => [n, 404]));
  });

  // ─── R38 — la escritura cruzada sobre `user`, con el rol real ───────────

  it('el PATCH que apunta a una identidad de otro tenant sigue en 404 y no la toca (R38)', async () => {
    const { rows: ajena } = await entorno.poolAdmin.query<{ id: string }>(
      `INSERT INTO "user" (tenant_id, email, password_hash, nombre)
       VALUES ($1, 'c7-ajena@example.com', NULL, 'Identidad De B') RETURNING id`,
      [TENANT_B],
    );
    const idAjena = ajena[0]!.id;
    await entorno.poolAdmin.query(
      `INSERT INTO user_role (user_id, tenant_id, rol) VALUES ($1, $2, 'propietario')`,
      [idAjena, TENANT_B],
    );
    const { rows: perfil } = await entorno.poolAdmin.query<{ id: string }>(
      `INSERT INTO perfil_propietario (tenant_id, user_id, tipo_documento, documento, email_contacto)
       VALUES ($1, $2, 'CC', 'C7-CRUZADO', 'c7@example.com') RETURNING id`,
      [TENANT_A, idAjena],
    );

    const respuesta = await request(servidor())
      .patch(`/propietarios/${perfil[0]!.id}`)
      .set('Authorization', `Bearer ${entorno.adminA.token}`)
      .set('x-tenant-id', TENANT_A)
      .send({ nombre: 'Nombre Robado' });

    expect(respuesta.status).toBe(404);

    const { rows } = await entorno.poolAdmin.query<{ nombre: string }>(
      'SELECT nombre FROM "user" WHERE id = $1',
      [idAjena],
    );
    expect(rows[0]?.nombre).toBe('Identidad De B');
  });
});
