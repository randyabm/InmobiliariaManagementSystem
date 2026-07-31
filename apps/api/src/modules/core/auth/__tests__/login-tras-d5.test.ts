import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CLAVE_DE_PRUEBA,
  type EntornoClientes,
  levantarEntornoClientes,
  TENANT_A,
} from '../../../../../test/support/entorno-clientes';
import { normalizarEmailDeLogin } from '../auth.service';

/**
 * El login sigue siendo correcto tras relajar `user.email` y
 * `user.password_hash` a NULL-able (**R6**, **R8**, D-5). T18 y T19.
 *
 * Contra PostgreSQL real: relajar un NOT NULL de la tabla de identidades es
 * exactamente el tipo de cambio cuyo efecto no se ve con mocks.
 */
describe('Login tras D-5 (#5 R6, R8)', () => {
  let entorno: EntornoClientes;

  beforeAll(async () => {
    entorno = await levantarEntornoClientes();
  }, 180_000);

  afterAll(async () => {
    await entorno?.cerrar();
  });

  const servidor = () => entorno.app.getHttpServer();

  // ─── T19 (a) — el login que funcionaba sigue funcionando ────────────────

  it('un usuario con credenciales sigue obteniendo access_token (R8a)', async () => {
    const respuesta = await request(servidor())
      .post('/auth/login')
      .send({ email: 'admin-a@example.com', password: CLAVE_DE_PRUEBA });

    expect(respuesta.status).toBe(201);
    expect(typeof respuesta.body.access_token).toBe('string');
    expect(respuesta.body.access_token.length).toBeGreaterThan(0);
    expect(respuesta.body.user.email).toBe('admin-a@example.com');
  });

  it('la contraseña equivocada sigue devolviendo 401', async () => {
    const respuesta = await request(servidor())
      .post('/auth/login')
      .send({ email: 'admin-a@example.com', password: 'no-es-la-clave' });

    expect(respuesta.status).toBe(401);
  });

  // ─── T18 — identidad sin credenciales no puede iniciar sesión (R6) ──────

  describe('identidad sin password_hash (R6)', () => {
    const casos: Array<[string, unknown]> = [
      ['contraseña vacía', ''],
      ['contraseña nula', null],
      ['contraseña arbitraria', 'lo-que-sea'],
    ];

    it.each(casos)(
      'un cliente registrado sin credenciales no entra con %s',
      async (_nombre, password) => {
        // El propietario se registra por la inmobiliaria (RF-C1) y no tiene
        // email, así que se intenta el login con el de otro usuario que sí
        // existe pero cuyo hash es NULL: el 401 debe venir del hash nulo.
        const { rows } = await entorno.poolAdmin.query<{ email: string }>(
          `UPDATE "user" SET email = 'sin-clave@example.com'
            WHERE id = $1 RETURNING email`,
          [entorno.clienteSinCredenciales.id],
        );
        expect(rows[0]?.email).toBe('sin-clave@example.com');

        const respuesta = await request(servidor())
          .post('/auth/login')
          .send({ email: 'sin-clave@example.com', password });

        expect(respuesta.status).toBe(401);
        expect(respuesta.body).not.toHaveProperty('access_token');
      },
    );

    it('el 401 no distingue "sin credenciales" de "credenciales inválidas"', async () => {
      const sinClave = await request(servidor())
        .post('/auth/login')
        .send({ email: 'sin-clave@example.com', password: 'x' });
      const inexistente = await request(servidor())
        .post('/auth/login')
        .send({ email: 'no-existe@example.com', password: 'x' });

      expect(sinClave.status).toBe(401);
      expect(inexistente.status).toBe(401);
      expect(sinClave.body.message).toBe(inexistente.body.message);
    });
  });

  // ─── T19 (b) y (c) — email nulo, ausente o vacío (R8) ───────────────────

  describe('email nulo, ausente o vacío (R8)', () => {
    const casos: Array<[string, Record<string, unknown>]> = [
      ['email nulo', { email: null, password: CLAVE_DE_PRUEBA }],
      ['email ausente', { password: CLAVE_DE_PRUEBA }],
      ['email vacío', { email: '', password: CLAVE_DE_PRUEBA }],
      ['email en blanco', { email: '   ', password: CLAVE_DE_PRUEBA }],
      ['cuerpo vacío', {}],
    ];

    it.each(casos)('%s devuelve 401', async (_nombre, cuerpo) => {
      const respuesta = await request(servidor()).post('/auth/login').send(cuerpo);

      expect(respuesta.status).toBe(401);
      expect(respuesta.body).not.toHaveProperty('access_token');
    });

    it('existiendo identidades con email NULL, ninguna de esas peticiones autentica a una de ellas', async () => {
      // Se siembran varias identidades sin email ni credenciales: son los
      // propietarios registrados sin correo que D-5 hace posibles.
      await entorno.poolAdmin.query(
        `INSERT INTO "user" (tenant_id, email, password_hash, nombre)
         VALUES ($1, NULL, NULL, 'Sin correo 1'), ($1, NULL, NULL, 'Sin correo 2')`,
        [TENANT_A],
      );
      const { rows: conteo } = await entorno.poolAdmin.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM "user" WHERE email IS NULL`,
      );
      expect(Number(conteo[0]?.total)).toBeGreaterThanOrEqual(2);

      for (const cuerpo of casos.map(([, c]) => c)) {
        const respuesta = await request(servidor()).post('/auth/login').send(cuerpo);
        expect(respuesta.status).toBe(401);
        expect(respuesta.body).not.toHaveProperty('access_token');
      }

      // Verificación independiente del código de estado: ningún login quedó
      // registrado en auditoría para una identidad sin email.
      const { rows } = await entorno.poolAdmin.query<{ total: string }>(
        `SELECT count(*)::text AS total
           FROM audit_log al
           JOIN "user" u ON u.id = al.actor_id
          WHERE al.accion = 'login' AND u.email IS NULL`,
      );
      expect(Number(rows[0]?.total)).toBe(0);
    });
  });

  // ─── La normalización, aislada ──────────────────────────────────────────

  describe('normalizarEmailDeLogin (R8)', () => {
    it('convierte a null todo lo que no es un email utilizable', () => {
      expect(normalizarEmailDeLogin(null)).toBeNull();
      expect(normalizarEmailDeLogin(undefined)).toBeNull();
      expect(normalizarEmailDeLogin('')).toBeNull();
      expect(normalizarEmailDeLogin('   ')).toBeNull();
      expect(normalizarEmailDeLogin(42)).toBeNull();
      expect(normalizarEmailDeLogin({})).toBeNull();
    });

    it('conserva un email utilizable sin espacios sobrantes', () => {
      expect(normalizarEmailDeLogin('  a@b.com ')).toBe('a@b.com');
    });
  });
});
