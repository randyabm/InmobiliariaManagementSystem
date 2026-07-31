import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type EntornoClientes,
  levantarEntornoClientes,
  TENANT_A,
  TENANT_B,
} from '../../../../../test/support/entorno-clientes';

/**
 * CRUD de propietario y creación en línea, contra PostgreSQL real y la app
 * NestJS real (T20, T21, T26, T27, T31 → R9, R10, R12, R13, R14, R16, R17,
 * R22, R23, R24, R25, R26).
 *
 * Las aserciones sobre el efecto en los datos se hacen con `SELECT`
 * independientes, no con el código de respuesta: un 200 no demuestra que la
 * fila haya cambiado (docs/verification.md, anti-patrones).
 */
describe('Propietarios — CRUD y creación en línea (#5)', () => {
  let entorno: EntornoClientes;

  beforeAll(async () => {
    entorno = await levantarEntornoClientes();
  }, 180_000);

  afterAll(async () => {
    await entorno?.cerrar();
  });

  const servidor = () => entorno.app.getHttpServer();

  const comoAdminA = (metodo: 'post' | 'get' | 'patch' | 'delete', ruta: string) =>
    request(servidor())
      [metodo](ruta)
      .set('Authorization', `Bearer ${entorno.adminA.token}`)
      .set('x-tenant-id', TENANT_A);

  const comoAdminB = (metodo: 'post' | 'get' | 'patch' | 'delete', ruta: string) =>
    request(servidor())
      [metodo](ruta)
      .set('Authorization', `Bearer ${entorno.adminB.token}`)
      .set('x-tenant-id', TENANT_B);

  // ─── T26 — CRUD (R9, R10, R13, R14, R16) ────────────────────────────────

  describe('creación (R10, R16)', () => {
    it('crea el propietario con datos personales y sujeto_retencion, y responde 201 con su id', async () => {
      const respuesta = await comoAdminA('post', '/propietarios').send({
        nombre: 'Ana Restrepo',
        tipo_documento: 'CC',
        documento: '1001',
        email: 'ana@example.com',
        telefono: '6041112233',
        direccion_notificacion: 'Calle 10 #43-20',
        ciudad: 'Medellin',
        sujeto_retencion: true,
      });

      expect(respuesta.status).toBe(201);
      expect(respuesta.body.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(respuesta.body.sujeto_retencion).toBe(true);
      expect(respuesta.body.tenant_id).toBe(TENANT_A);
      expect(respuesta.body.activo).toBe(true);

      // Verificación independiente: la fila existe en el tenant correcto.
      const { rows } = await entorno.poolAdmin.query<{
        tenant_id: string;
        sujeto_retencion: boolean;
        ciudad: string;
      }>('SELECT tenant_id, sujeto_retencion, ciudad FROM perfil_propietario WHERE id = $1', [
        respuesta.body.id,
      ]);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.tenant_id).toBe(TENANT_A);
      expect(rows[0]?.sujeto_retencion).toBe(true);
      expect(rows[0]?.ciudad).toBe('Medellin');
    });

    it('crea el propietario SIN email (D-5) y le asigna una identidad sin credenciales', async () => {
      const respuesta = await comoAdminA('post', '/propietarios').send({
        nombre: 'Bernardo Sin Correo',
        tipo_documento: 'CC',
        documento: '1002',
      });

      expect(respuesta.status).toBe(201);
      expect(respuesta.body.email).toBeNull();
      expect(respuesta.body.sujeto_retencion).toBe(false);

      const { rows } = await entorno.poolAdmin.query<{
        email: string | null;
        password_hash: string | null;
      }>(
        `SELECT u.email, u.password_hash FROM "user" u
           JOIN perfil_propietario p ON p.user_id = u.id WHERE p.id = $1`,
        [respuesta.body.id],
      );
      expect(rows[0]?.email).toBeNull();
      // R6: sin credenciales, así que no puede iniciar sesión.
      expect(rows[0]?.password_hash).toBeNull();
    });

    it('el empleado también puede crear (R10)', async () => {
      const respuesta = await request(servidor())
        .post('/propietarios')
        .set('Authorization', `Bearer ${entorno.empleadoA.token}`)
        .set('x-tenant-id', TENANT_A)
        .send({ nombre: 'Carla Empleada', tipo_documento: 'CE', documento: '1003' });

      expect(respuesta.status).toBe(201);
    });

    it('rechaza con 400 si faltan los campos mínimos', async () => {
      const sinNombre = await comoAdminA('post', '/propietarios').send({
        tipo_documento: 'CC',
        documento: '1004',
      });
      const tipoInvalido = await comoAdminA('post', '/propietarios').send({
        nombre: 'X',
        tipo_documento: 'TARJETA',
        documento: '1004',
      });

      expect(sinNombre.status).toBe(400);
      expect(tipoInvalido.status).toBe(400);

      const { rows } = await entorno.poolAdmin.query(
        'SELECT id FROM perfil_propietario WHERE documento = $1',
        ['1004'],
      );
      expect(rows).toHaveLength(0);
    });
  });

  // ─── T27 — contrato de la hoja de vida (R12, R17, D-1, D-3) ─────────────

  describe('hoja de vida GET /propietarios/:id (R12, R17)', () => {
    let idPropietario: string;

    beforeAll(async () => {
      const creado = await comoAdminA('post', '/propietarios').send({
        nombre: 'Diana Hoja',
        tipo_documento: 'CC',
        documento: '2001',
        email: 'diana@example.com',
        ciudad: 'Bogota',
        sujeto_retencion: true,
      });
      idPropietario = creado.body.id;

      await comoAdminA('post', `/propietarios/${idPropietario}/cuentas-bancarias`).send({
        banco: 'Bancolombia',
        tipo_cuenta: 'AHORROS',
        numero_cuenta: '11112222',
        titular_nombre: 'Diana Hoja',
        titular_tipo_documento: 'CC',
        titular_documento: '2001',
      });
    });

    it('devuelve 200 con datos personales, sujeto_retencion y la cuenta predeterminada', async () => {
      const respuesta = await comoAdminA('get', `/propietarios/${idPropietario}`);

      expect(respuesta.status).toBe(200);
      expect(respuesta.body.nombre).toBe('Diana Hoja');
      expect(respuesta.body.email).toBe('diana@example.com');
      expect(respuesta.body.sujeto_retencion).toBe(true);
      expect(respuesta.body.cuentas_bancarias).toHaveLength(1);
      expect(respuesta.body.cuenta_predeterminada_id).toBe(
        respuesta.body.cuentas_bancarias[0].id,
      );
      expect(respuesta.body.cuentas_bancarias[0].es_predeterminada).toBe(true);
    });

    it('NO expone propiedades ni certificados fiscales (D-1, D-3)', async () => {
      const respuesta = await comoAdminA('get', `/propietarios/${idPropietario}`);

      // D-1: ni siquiera un array vacío reservado. La entidad Propiedad es de
      // la feature #6 y un campo reservado sería API muerta.
      expect(respuesta.body).not.toHaveProperty('propiedades');
      expect(respuesta.body).not.toHaveProperty('properties');
      expect(respuesta.body).not.toHaveProperty('certificados');
      expect(respuesta.body).not.toHaveProperty('certificados_fiscales');

      const claves = Object.keys(respuesta.body);
      expect(claves.filter((c) => /propiedad|certificad/i.test(c))).toEqual([]);
    });

    it('NO expone ningún porcentaje ni tarifa de retención (R17, D-2)', async () => {
      const respuesta = await comoAdminA('get', `/propietarios/${idPropietario}`);

      // #5 captura y devuelve `sujeto_retencion`, pero NO calcula retención:
      // la tarifa por tenant y año es alcance de la feature #25.
      const claves = Object.keys(respuesta.body);
      expect(claves.filter((c) => /porcentaje|tarifa|retencion/i.test(c))).toEqual([
        'sujeto_retencion',
      ]);

      const serializado = JSON.stringify(respuesta.body);
      expect(serializado).not.toMatch(/porcentaje_retencion|tarifa_retencion/i);
    });
  });

  // ─── T26 — PATCH y baja lógica (R13, R14) ───────────────────────────────

  describe('actualización y baja (R13, R14)', () => {
    it('el PATCH parcial aplica solo los campos enviados y refresca updated_at', async () => {
      const creado = await comoAdminA('post', '/propietarios').send({
        nombre: 'Elena Patch',
        tipo_documento: 'CC',
        documento: '3001',
        ciudad: 'Cali',
        direccion_notificacion: 'Av 1',
        sujeto_retencion: false,
      });
      const id = creado.body.id;
      const antes = await entorno.poolAdmin.query<{ updated_at: Date }>(
        'SELECT updated_at FROM perfil_propietario WHERE id = $1',
        [id],
      );

      const respuesta = await comoAdminA('patch', `/propietarios/${id}`).send({
        ciudad: 'Barranquilla',
        sujeto_retencion: true,
      });

      expect(respuesta.status).toBe(200);
      expect(respuesta.body.ciudad).toBe('Barranquilla');
      expect(respuesta.body.sujeto_retencion).toBe(true);
      // Lo NO enviado no se toca.
      expect(respuesta.body.direccion_notificacion).toBe('Av 1');
      expect(respuesta.body.nombre).toBe('Elena Patch');

      const despues = await entorno.poolAdmin.query<{ updated_at: Date }>(
        'SELECT updated_at FROM perfil_propietario WHERE id = $1',
        [id],
      );
      expect(despues.rows[0]!.updated_at.getTime()).toBeGreaterThanOrEqual(
        antes.rows[0]!.updated_at.getTime(),
      );
    });

    it('el DELETE deja la fila con activo = false y NO la borra (R14)', async () => {
      const creado = await comoAdminA('post', '/propietarios').send({
        nombre: 'Fabio Baja',
        tipo_documento: 'CC',
        documento: '3002',
      });
      const id = creado.body.id;

      const respuesta = await comoAdminA('delete', `/propietarios/${id}`);
      expect(respuesta.status).toBe(200);

      // Verificado con SELECT, no por el código de respuesta.
      const { rows } = await entorno.poolAdmin.query<{ activo: boolean }>(
        'SELECT activo FROM perfil_propietario WHERE id = $1',
        [id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.activo).toBe(false);
    });
  });

  // ─── T26/R23/R24 — crear si no existe (D-4) ─────────────────────────────

  describe('crear si no existe (R23, R24, D-4)', () => {
    it('la búsqueda por documento devuelve el perfil del tenant, o lista vacía', async () => {
      await comoAdminA('post', '/propietarios').send({
        nombre: 'Gloria Busqueda',
        tipo_documento: 'CC',
        documento: '4001',
      });

      const encontrado = await comoAdminA(
        'get',
        '/propietarios?tipo_documento=CC&documento=4001',
      );
      expect(encontrado.status).toBe(200);
      expect(encontrado.body).toHaveLength(1);
      expect(encontrado.body[0].documento).toBe('4001');

      const vacio = await comoAdminA(
        'get',
        '/propietarios?tipo_documento=CC&documento=no-existe',
      );
      expect(vacio.status).toBe(200);
      expect(vacio.body).toEqual([]);
    });

    it('el mismo documento en OTRO tenant no aparece en la búsqueda (R23, §11.3)', async () => {
      await comoAdminB('post', '/propietarios').send({
        nombre: 'Solo En B',
        tipo_documento: 'CC',
        documento: '4002',
      });

      const desdeA = await comoAdminA(
        'get',
        '/propietarios?tipo_documento=CC&documento=4002',
      );

      // Encontrarlo revelaría que la persona ya es cliente de otra
      // inmobiliaria (D-7, PRD §11.3).
      expect(desdeA.status).toBe(200);
      expect(desdeA.body).toEqual([]);
    });

    it('repetir el documento en el mismo tenant devuelve 409 PERFIL_YA_EXISTE (R24)', async () => {
      await comoAdminA('post', '/propietarios').send({
        nombre: 'Hugo Duplicado',
        tipo_documento: 'CC',
        documento: '4003',
      });

      const repetido = await comoAdminA('post', '/propietarios').send({
        nombre: 'Hugo Otra Vez',
        tipo_documento: 'CC',
        documento: '4003',
      });

      expect(repetido.status).toBe(409);
      expect(repetido.body.error).toBe('PERFIL_YA_EXISTE');

      const { rows } = await entorno.poolAdmin.query(
        'SELECT id FROM perfil_propietario WHERE tenant_id = $1 AND documento = $2',
        [TENANT_A, '4003'],
      );
      expect(rows).toHaveLength(1);
    });

    it('el 409 no filtra el documento de nadie (R36)', async () => {
      const repetido = await comoAdminA('post', '/propietarios').send({
        nombre: 'Hugo Tercera',
        tipo_documento: 'CC',
        documento: '4003',
      });

      expect(JSON.stringify(repetido.body)).not.toContain('4003');
    });
  });

  // ─── T20 — atomicidad de la creación (R22) ──────────────────────────────

  describe('creación atómica (R22)', () => {
    it('si falla el INSERT del perfil, no quedan filas nuevas en user ni user_role', async () => {
      const contar = async () => {
        const { rows } = await entorno.poolAdmin.query<{ u: string; ur: string }>(
          `SELECT (SELECT count(*) FROM "user")::text AS u,
                  (SELECT count(*) FROM user_role)::text AS ur`,
        );
        return { users: Number(rows[0]!.u), roles: Number(rows[0]!.ur) };
      };

      const antes = await contar();

      // Se fuerza el fallo justo en el INSERT del perfil, que es la última de
      // las tres escrituras: si la transacción no fuese única, `user` y
      // `user_role` ya estarían confirmados.
      await entorno.poolAdmin.query(`
        CREATE OR REPLACE FUNCTION fallar_insert_perfil() RETURNS TRIGGER AS $fn$
        BEGIN
          RAISE EXCEPTION 'fallo forzado en el INSERT del perfil';
        END;
        $fn$ LANGUAGE plpgsql`);
      await entorno.poolAdmin.query(`
        CREATE TRIGGER trg_fallar_insert_perfil
          BEFORE INSERT ON perfil_propietario
          FOR EACH ROW EXECUTE FUNCTION fallar_insert_perfil()`);

      try {
        const respuesta = await comoAdminA('post', '/propietarios').send({
          nombre: 'Nunca Persistido',
          tipo_documento: 'CC',
          documento: '5001',
          email: 'nunca-persistido@example.com',
        });

        expect(respuesta.status).toBe(500);
      } finally {
        await entorno.poolAdmin.query(
          'DROP TRIGGER IF EXISTS trg_fallar_insert_perfil ON perfil_propietario',
        );
      }

      const despues = await contar();
      expect(despues).toEqual(antes);

      const { rows } = await entorno.poolAdmin.query(
        `SELECT id FROM "user" WHERE email = $1`,
        ['nunca-persistido@example.com'],
      );
      expect(rows).toHaveLength(0);
    });
  });

  // ─── T21 — identidad entre tenants (R26/R62) ────────────────────────────

  describe('identidad entre tenants (R26, R62)', () => {
    // El caso (a) —"reutiliza el `user` existente en otro tenant"— probaba
    // **R25**, que **D-8 eliminó**: las identidades nunca se comparten entre
    // inmobiliarias. Se retira aquí, en T54, y no en T58 como decía el plan,
    // porque el esquema de D-8 lo hace irrepresentable antes de que T58 llegue:
    // `user.tenant_id` y la FK compuesta de R60 impiden que un `user_role` del
    // tenant A cuelgue de una identidad del tenant B.
    //
    // Lo que lo sustituye es **R62** (la identidad es siempre nueva, coincida o
    // no el correo), y su test vive en `login-por-inmobiliaria.api.test.ts`
    // (T59): es allí donde sembrar el mismo correo en dos inmobiliarias tiene
    // sentido, porque es allí donde se demuestra que cada una autentica con su
    // propio `codigo`. `design.md` §20.5 prohíbe expresamente sembrar correos
    // duplicados antes de T57, y por eso el caso no se queda aquí.

    it('(b) SIN email crea identidad nueva y no vincula por documento (R26)', async () => {
      const enB = await comoAdminB('post', '/propietarios').send({
        nombre: 'Julian Sin Correo',
        tipo_documento: 'CC',
        documento: '7001',
      });
      const enA = await comoAdminA('post', '/propietarios').send({
        nombre: 'Julian Sin Correo',
        tipo_documento: 'CC',
        documento: '7001',
      });

      expect(enB.status).toBe(201);
      expect(enA.status).toBe(201);

      // Buscar por documento fuera del tenant revelaría que la persona ya es
      // cliente de otra inmobiliaria (§11.3). Consecuencia asumida (§7.3):
      // dos filas de `user` para la misma persona física.
      expect(enA.body.user_id).not.toBe(enB.body.user_id);

      const { rows } = await entorno.poolAdmin.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM "user" WHERE id IN ($1, $2)`,
        [enA.body.user_id, enB.body.user_id],
      );
      expect(Number(rows[0]?.total)).toBe(2);
    });
  });

  // ─── T31 — cambio de cuenta predeterminada (R15) ────────────────────────

  describe('cuenta predeterminada (R11, R15)', () => {
    it('la primera cuenta queda predeterminada y el PATCH deja exactamente una', async () => {
      const propietario = await comoAdminA('post', '/propietarios').send({
        nombre: 'Karla Cuentas',
        tipo_documento: 'CC',
        documento: '8001',
      });
      const id = propietario.body.id;

      const primera = await comoAdminA(
        'post',
        `/propietarios/${id}/cuentas-bancarias`,
      ).send({
        banco: 'Bancolombia',
        tipo_cuenta: 'AHORROS',
        numero_cuenta: '9001',
        titular_nombre: 'Karla Cuentas',
        titular_tipo_documento: 'CC',
        titular_documento: '8001',
      });
      expect(primera.status).toBe(201);
      expect(primera.body.es_predeterminada).toBe(true);

      const segunda = await comoAdminA(
        'post',
        `/propietarios/${id}/cuentas-bancarias`,
      ).send({
        banco: 'Davivienda',
        tipo_cuenta: 'CORRIENTE',
        numero_cuenta: '9002',
        titular_nombre: 'Karla Cuentas',
        titular_tipo_documento: 'CC',
        titular_documento: '8001',
      });
      expect(segunda.status).toBe(201);
      expect(segunda.body.es_predeterminada).toBe(false);

      const cambio = await comoAdminA(
        'patch',
        `/propietarios/${id}/cuentas-bancarias/${segunda.body.id}`,
      ).send({ es_predeterminada: true });
      expect(cambio.status).toBe(200);

      // Exactamente UNA cuenta activa predeterminada tras el cambio.
      const { rows } = await entorno.poolAdmin.query<{ id: string }>(
        `SELECT id FROM cuenta_bancaria
          WHERE perfil_propietario_id = $1 AND activa AND es_predeterminada`,
        [id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(segunda.body.id);
    });

    it('GET de cuentas lista las activas y marca la predeterminada', async () => {
      const propietario = await comoAdminA('post', '/propietarios').send({
        nombre: 'Luis Listado',
        tipo_documento: 'CC',
        documento: '8002',
      });
      const id = propietario.body.id;

      await comoAdminA('post', `/propietarios/${id}/cuentas-bancarias`).send({
        banco: 'Nequi',
        tipo_cuenta: 'AHORROS',
        numero_cuenta: '9003',
        titular_nombre: 'Luis Listado',
        titular_tipo_documento: 'CC',
        titular_documento: '8002',
      });

      const respuesta = await comoAdminA('get', `/propietarios/${id}/cuentas-bancarias`);

      expect(respuesta.status).toBe(200);
      expect(respuesta.body).toHaveLength(1);
      expect(respuesta.body[0].es_predeterminada).toBe(true);
      expect(respuesta.body[0].numero_cuenta).toBe('9003');
    });
  });
});
