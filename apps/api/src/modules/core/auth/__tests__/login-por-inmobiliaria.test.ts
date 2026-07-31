import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CLAVE_DE_PRUEBA,
  CODIGO_TENANT_A,
  CODIGO_TENANT_B,
  type EntornoClientes,
  levantarEntornoClientes,
  TENANT_A,
  TENANT_B,
} from '../../../../../test/support/entorno-clientes';

/**
 * **T59 — R51, R62, R63, R64, R65, R74**: el login sabe en qué inmobiliaria
 * entra.
 *
 * ## El escenario que antes era imposible
 *
 * Aquí —y **solo** aquí, siguiendo `design.md` §20.5— se siembra **el mismo
 * correo en dos inmobiliarias distintas**. Antes de D-8 la `UNIQUE(email)`
 * global lo impedía; ahora son dos personas distintas, cada una con su
 * contraseña, y el `codigo` es lo único que las distingue. Sembrarlo antes de
 * que el login lo entendiera habría dejado una consulta ambigua resolviéndose
 * por azar, que es justo lo que el orden de tasks evita.
 *
 * ## La propiedad de seguridad que se prueba
 *
 * Que el 401 sea **indistinguible** en los cuatro casos —código inexistente,
 * correo de otra inmobiliaria, sin `password_hash` y contraseña mala—. Si el
 * código inexistente respondiera algo distinto, el formulario de acceso sería
 * un directorio de los clientes del SaaS (**R64**). El **400** se reserva para
 * el error de forma del código, que no depende de qué inmobiliarias existan.
 */
describe('Login por inmobiliaria (#5 R51, R62–R65, R74, D-8, D-12)', () => {
  let entorno: EntornoClientes;

  /** El mismo correo, dos personas, dos inmobiliarias. */
  const CORREO_COMPARTIDO = 'misma-persona@example.com';
  const CLAVE_EN_A = 'clave-de-la-persona-en-a';
  const CLAVE_EN_B = 'clave-de-la-persona-en-b';

  let idEnA = '';
  let idEnB = '';

  beforeAll(async () => {
    entorno = await levantarEntornoClientes();

    const bcrypt = await import('bcrypt');
    const sembrar = async (
      tenantId: string,
      nombre: string,
      clave: string,
    ): Promise<string> => {
      const { rows } = await entorno.poolAdmin.query<{ id: string }>(
        `INSERT INTO "user" (tenant_id, email, password_hash, nombre)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [tenantId, CORREO_COMPARTIDO, await bcrypt.hash(clave, 10), nombre],
      );
      const id = rows[0]!.id;
      await entorno.poolAdmin.query(
        `INSERT INTO user_role (user_id, tenant_id, rol) VALUES ($1, $2, 'admin')`,
        [id, tenantId],
      );
      return id;
    };

    idEnA = await sembrar(TENANT_A, 'Persona En A', CLAVE_EN_A);
    idEnB = await sembrar(TENANT_B, 'Persona En B', CLAVE_EN_B);
    expect(idEnA).not.toBe(idEnB);
  }, 180_000);

  afterAll(async () => {
    await entorno?.cerrar();
  });

  const login = (cuerpo: Record<string, unknown>) =>
    request(entorno.app.getHttpServer()).post('/auth/login').send(cuerpo);

  // ─── R65 — mismo correo en dos inmobiliarias ────────────────────────────

  describe('mismo correo en dos inmobiliarias (R65)', () => {
    it('cada persona se autentica con el código de la suya y recibe SU token', async () => {
      const enA = await login({
        codigo: CODIGO_TENANT_A,
        email: CORREO_COMPARTIDO,
        password: CLAVE_EN_A,
      });
      const enB = await login({
        codigo: CODIGO_TENANT_B,
        email: CORREO_COMPARTIDO,
        password: CLAVE_EN_B,
      });

      expect(enA.status).toBe(201);
      expect(enB.status).toBe(201);
      expect(enA.body.user.id).toBe(idEnA);
      expect(enB.body.user.id).toBe(idEnB);
      expect(enA.body.access_token).not.toBe(enB.body.access_token);
    });

    it('el token lleva el tenant y los roles de SU inmobiliaria (R67)', async () => {
      const enA = await login({
        codigo: CODIGO_TENANT_A,
        email: CORREO_COMPARTIDO,
        password: CLAVE_EN_A,
      });

      const carga = JSON.parse(
        Buffer.from(enA.body.access_token.split('.')[1], 'base64').toString(),
      ) as { tenant_id: string; roles: Array<{ tenant_id: string }> };

      expect(carga.tenant_id).toBe(TENANT_A);
      expect(carga.roles.length).toBeGreaterThan(0);
      expect(carga.roles.every((r) => r.tenant_id === TENANT_A)).toBe(true);
    });

    it('ninguna de las dos autentica con el código de la otra (R64)', async () => {
      // La clave es correcta... pero para la otra inmobiliaria. El RLS deja la
      // fila fuera de alcance y el resultado es un 401 corriente.
      const cruzadoAB = await login({
        codigo: CODIGO_TENANT_B,
        email: CORREO_COMPARTIDO,
        password: CLAVE_EN_A,
      });
      const cruzadoBA = await login({
        codigo: CODIGO_TENANT_A,
        email: CORREO_COMPARTIDO,
        password: CLAVE_EN_B,
      });

      expect(cruzadoAB.status).toBe(401);
      expect(cruzadoBA.status).toBe(401);
      expect(cruzadoAB.body).not.toHaveProperty('access_token');
      expect(cruzadoBA.body).not.toHaveProperty('access_token');
    });

    it('un correo que solo existe en otra inmobiliaria no autentica (R64)', async () => {
      const respuesta = await login({
        codigo: CODIGO_TENANT_B,
        email: 'admin-a@example.com',
        password: CLAVE_DE_PRUEBA,
      });

      expect(respuesta.status).toBe(401);
    });
  });

  // ─── R64 — el 401 no revela qué inmobiliarias existen ───────────────────

  describe('el 401 es indistinguible (R64)', () => {
    it('código inexistente responde exactamente igual que credenciales malas', async () => {
      const codigoInexistente = await login({
        codigo: 'esta-inmobiliaria-no-existe',
        email: 'admin-a@example.com',
        password: CLAVE_DE_PRUEBA,
      });
      const claveMala = await login({
        codigo: CODIGO_TENANT_A,
        email: 'admin-a@example.com',
        password: 'no-es-la-clave',
      });

      expect(codigoInexistente.status).toBe(401);
      expect(claveMala.status).toBe(401);
      // Mismo cuerpo salvo la marca de tiempo: ni el mensaje ni el código de
      // error pueden servir para distinguir un caso del otro.
      expect(codigoInexistente.body.message).toBe(claveMala.body.message);
      expect(codigoInexistente.body.error).toBe(claveMala.body.error);
      expect(codigoInexistente.body.statusCode).toBe(claveMala.body.statusCode);
    });

    it('el cuerpo del 401 no menciona ningún código de inmobiliaria', async () => {
      const respuesta = await login({
        codigo: CODIGO_TENANT_A,
        email: 'admin-a@example.com',
        password: 'no-es-la-clave',
      });

      const cuerpo = JSON.stringify(respuesta.body);
      expect(cuerpo).not.toContain(CODIGO_TENANT_A);
      expect(cuerpo).not.toContain(CODIGO_TENANT_B);
      expect(cuerpo).not.toContain(TENANT_A);
    });
  });

  // ─── R63 — el código falta o está mal formado: 400 ──────────────────────

  describe('código ausente o mal formado (R63)', () => {
    const casos: Array<[string, unknown]> = [
      ['ausente', undefined],
      ['nulo', null],
      ['vacío', ''],
      ['en blanco', '   '],
      ['con tilde', 'inmobiliaría-a'],
      ['con espacio interior', 'inmobiliaria a'],
      ['con guion inicial', '-inmobiliaria-a'],
      ['demasiado corto', 'ab'],
      ['demasiado largo', 'a'.repeat(64)],
      ['reservado (www)', 'www'],
      ['no es texto', 42],
    ];

    it.each(casos)('%s devuelve 400, no 401', async (_nombre, codigo) => {
      const cuerpo: Record<string, unknown> = {
        email: 'admin-a@example.com',
        password: CLAVE_DE_PRUEBA,
      };
      if (codigo !== undefined) cuerpo.codigo = codigo;

      const respuesta = await login(cuerpo);

      // 400 y no 401 a propósito: es error de forma de lo que el cliente
      // escribió, y su respuesta no depende de qué inmobiliarias existen, así
      // que no revela nada (design.md §20.2).
      expect(respuesta.status).toBe(400);
      expect(respuesta.body).not.toHaveProperty('access_token');
    });
  });

  // ─── R74 — normalización del código ─────────────────────────────────────

  describe('normalización del código recibido (R74)', () => {
    it.each([
      ['mayúsculas', CODIGO_TENANT_A.toUpperCase()],
      ['espacios sobrantes', `  ${CODIGO_TENANT_A}  `],
      ['ambas cosas', `  ${CODIGO_TENANT_A.toUpperCase()} `],
    ])('%s autentica igual', async (_nombre, codigo) => {
      const respuesta = await login({
        codigo,
        email: 'admin-a@example.com',
        password: CLAVE_DE_PRUEBA,
      });

      expect(respuesta.status).toBe(201);
      expect(typeof respuesta.body.access_token).toBe('string');
    });
  });

  // ─── R62 — la identidad de un cliente es SIEMPRE nueva ──────────────────

  describe('la identidad de un cliente es siempre nueva (R62)', () => {
    it('el mismo correo en dos inmobiliarias produce DOS identidades', async () => {
      const correo = 'cliente-en-dos@example.com';

      const enB = await request(entorno.app.getHttpServer())
        .post('/propietarios')
        .set('Authorization', `Bearer ${entorno.adminB.token}`)
        .set('x-tenant-id', TENANT_B)
        .send({
          nombre: 'Irene En Dos',
          tipo_documento: 'CC',
          documento: 'R62-B',
          email: correo,
          ciudad: 'Cartagena',
          direccion_notificacion: 'Direccion secreta del tenant B',
          sujeto_retencion: true,
        });
      expect(enB.status).toBe(201);

      const enA = await request(entorno.app.getHttpServer())
        .post('/propietarios')
        .set('Authorization', `Bearer ${entorno.adminA.token}`)
        .set('x-tenant-id', TENANT_A)
        .send({
          nombre: 'Irene En Dos',
          tipo_documento: 'CC',
          documento: 'R62-A',
          email: correo,
          ciudad: 'Medellin',
        });
      expect(enA.status).toBe(201);

      // Sustituye al antiguo caso de R25, donde se REUTILIZABA la fila ajena.
      expect(enA.body.user_id).not.toBe(enB.body.user_id);

      // D-9 (R71): el correo NO está en `user` —ahí queda NULL— sino en el
      // `email_contacto` de cada perfil, uno por inmobiliaria.
      const { rows } = await entorno.poolAdmin.query<{
        tenant_id: string;
        email_user: string | null;
      }>(
        `SELECT p.tenant_id::text, u.email AS email_user
           FROM perfil_propietario p JOIN "user" u ON u.id = p.user_id
          WHERE p.email_contacto = $1 ORDER BY p.tenant_id`,
        [correo],
      );
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.tenant_id)).toEqual([TENANT_A, TENANT_B]);
      expect(rows.every((r) => r.email_user === null)).toBe(true);

      // Y la respuesta del tenant A no trae NADA del perfil del tenant B.
      const serializado = JSON.stringify(enA.body);
      expect(serializado).not.toContain('Cartagena');
      expect(serializado).not.toContain('Direccion secreta del tenant B');
      expect(serializado).not.toContain(TENANT_B);
      expect(serializado).not.toContain('R62-B');
      expect(enA.body.sujeto_retencion).toBe(false);
    });

    it('ninguna de las dos identidades nuevas puede iniciar sesión (R6, R71)', async () => {
      // Un cliente registrado por la inmobiliaria no tiene `password_hash` y,
      // desde D-9, tampoco `user.email`: su correo es de contacto, no una
      // credencial. Ninguna de las dos cosas le abre la puerta.
      for (const codigo of [CODIGO_TENANT_A, CODIGO_TENANT_B]) {
        const respuesta = await login({
          codigo,
          email: 'cliente-en-dos@example.com',
          password: 'lo-que-sea',
        });
        expect(respuesta.status).toBe(401);
      }
    });
  });
});
