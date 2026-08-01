import * as jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type EntornoClientes,
  JWT_SECRET_DE_PRUEBA,
  levantarEntornoClientes,
  TENANT_A,
  TENANT_B,
} from '../../../../../test/support/entorno-clientes';

/**
 * **T23, T24, T25, T26 — R15, R16, R17, R18, R19, R20, R21, R22, R23, R29.**
 *
 * El bloque B de la #26 contra la aplicación real y PostgreSQL real: consultar
 * los roles propios (`GET /auth/me`, que cierra además la deuda **D3**: cambió
 * en la #5 sin un solo test funcional) y elegir con cuál se actúa
 * (`POST /auth/rol-activo`).
 *
 * ## Sobre los tokens que firma este archivo
 *
 * Se firman aquí, con el secreto **inerte** de test, porque hacen falta tokens
 * que **afirman** cosas concretas —incluido alguno incoherente a propósito, que
 * es la amenaza contra la que R29 defiende— y eso no se puede pedir por HTTP.
 * Es el mismo mecanismo que ya usa `test/support/entorno-clientes.ts`.
 *
 * Ningún objeto de esquema se crea aquí (`tests/ddl-en-tests.test.ts`).
 */
describe('Rol activo: consultar y elegir (#26 bloque B)', () => {
  let entorno: EntornoClientes;
  let servidor: () => ReturnType<EntornoClientes['app']['getHttpServer']>;

  /** Identidad con dos roles reales en A: `empleado` y `propietario`. */
  let multirol: { id: string; token: string };

  beforeAll(async () => {
    entorno = await levantarEntornoClientes();
    servidor = () => entorno.app.getHttpServer();

    // Se siembra con el pool privilegiado —eso es el estímulo, no la
    // afirmación— una identidad que de verdad tiene los dos roles en A.
    //
    // Se eligen `empleado` y `propietario` y no `propietario`+`inquilino`
    // porque **hoy no existe ninguna ruta que exija rol de cliente**: el portal
    // del cliente (RF-AU2/AU4) no está en el tablero y esta feature no inventa
    // endpoints para poder probarse. Con `empleado` la identidad alcanza rutas
    // reales, y con `propietario` no: eso basta para demostrar extremo a
    // extremo que el rol activo **restringe**. La simetría estricta
    // propietario/inquilino se fija en `rol-activo-guard.test.ts`.
    const { rows } = await entorno.poolAdmin.query<{ id: string }>(
      `INSERT INTO "user" (tenant_id, email, password_hash, nombre)
       VALUES ($1, 'multirol-a@example.com', NULL, 'Multirol A') RETURNING id`,
      [TENANT_A],
    );
    const id = rows[0]!.id;
    await entorno.poolAdmin.query(
      `INSERT INTO user_role (user_id, tenant_id, rol) VALUES ($1, $2, 'empleado'), ($1, $2, 'propietario')`,
      [id, TENANT_A],
    );

    multirol = {
      id,
      token: firmar(id, 'multirol-a@example.com', [
        { tenant_id: TENANT_A, rol: 'empleado' },
        { tenant_id: TENANT_A, rol: 'propietario' },
      ]),
    };
  }, 180_000);

  afterAll(async () => {
    await entorno?.cerrar();
  });

  function firmar(
    sub: string,
    email: string | null,
    roles: Array<{ tenant_id: string; rol: string }>,
    rolActivo?: string,
  ): string {
    return jwt.sign(
      {
        sub,
        email,
        tenant_id: roles[0]?.tenant_id,
        roles,
        ...(rolActivo === undefined ? {} : { rol_activo: rolActivo }),
      },
      JWT_SECRET_DE_PRUEBA,
      { expiresIn: '1h' },
    );
  }

  // ─── T23 — GET /auth/me (R15, R22; deuda D3) ────────────────────────────

  describe('T23 — GET /auth/me devuelve los roles propios (R15)', () => {
    it('200 con el perfil y los roles del tenant del token', async () => {
      const respuesta = await request(servidor())
        .get('/auth/me')
        .set('Authorization', `Bearer ${multirol.token}`);

      expect(respuesta.status).toBe(200);
      expect(respuesta.body.id).toBe(multirol.id);
      expect(respuesta.body.nombre).toBe('Multirol A');
      expect(
        respuesta.body.roles.map((r: { rol: string }) => r.rol).sort(),
      ).toEqual(['empleado', 'propietario']);
      expect(
        respuesta.body.roles.every(
          (r: { tenant_id: string }) => r.tenant_id === TENANT_A,
        ),
      ).toBe(true);
    });

    it('no incluye roles de ninguna otra inmobiliaria (R15, R22)', async () => {
      const respuesta = await request(servidor())
        .get('/auth/me')
        .set('Authorization', `Bearer ${entorno.adminB.token}`);

      expect(respuesta.status).toBe(200);
      const tenants = respuesta.body.roles.map(
        (r: { tenant_id: string }) => r.tenant_id,
      );
      expect([...new Set(tenants)]).toEqual([TENANT_B]);
      expect(tenants).not.toContain(TENANT_A);
    });

    it('un token que AFIRMA un rol ajeno no obtiene perfil ninguno (R22)', async () => {
      // `tokenConRolAjeno` es una identidad del tenant B cuyo token declara
      // además un rol en A: el escenario de token manipulado. El tenant se
      // deduce del token, la consulta corre bajo el contexto de A y el RLS no
      // encuentra a esa persona allí. 401, y ni un dato de A en la respuesta.
      const respuesta = await request(servidor())
        .get('/auth/me')
        .set('Authorization', `Bearer ${entorno.tokenConRolAjeno.token}`);

      expect(respuesta.status).toBe(401);
      expect(JSON.stringify(respuesta.body)).not.toContain(TENANT_A);
    });

    it('401 sin token', async () => {
      const respuesta = await request(servidor()).get('/auth/me');
      expect(respuesta.status).toBe(401);
    });

    it('401 con un token firmado con otro secreto', async () => {
      const falsificado = jwt.sign(
        { sub: multirol.id, roles: [{ tenant_id: TENANT_A, rol: 'admin' }] },
        'otro-secreto-inerte-de-test',
        { expiresIn: '1h' },
      );

      const respuesta = await request(servidor())
        .get('/auth/me')
        .set('Authorization', `Bearer ${falsificado}`);
      expect(respuesta.status).toBe(401);
    });
  });

  // ─── T24 — el rol elegido restringe (R16, R18, R23) ─────────────────────

  describe('T24 — elegir rol restringe el acceso de verdad (R16, R18)', () => {
    it('POST /auth/rol-activo devuelve un token nuevo con el rol elegido', async () => {
      const respuesta = await request(servidor())
        .post('/auth/rol-activo')
        .set('Authorization', `Bearer ${multirol.token}`)
        .send({ rol: 'propietario' });

      expect(respuesta.status).toBe(200);
      expect(respuesta.body.rol_activo).toBe('propietario');
      expect(typeof respuesta.body.access_token).toBe('string');

      const payload = jwt.verify(
        respuesta.body.access_token,
        JWT_SECRET_DE_PRUEBA,
      ) as Record<string, unknown>;
      expect(payload.rol_activo).toBe('propietario');
      expect(payload.sub).toBe(multirol.id);
      expect(payload.tenant_id).toBe(TENANT_A);
    });

    it('con el rol de cliente elegido, las rutas de empleado responden 403', async () => {
      const emitido = await request(servidor())
        .post('/auth/rol-activo')
        .set('Authorization', `Bearer ${multirol.token}`)
        .send({ rol: 'propietario' });

      // Misma identidad, mismo tenant, MISMOS roles activos en la base. Lo
      // único que cambia es con cuál eligió actuar.
      const respuesta = await request(servidor())
        .get('/propietarios')
        .set('Authorization', `Bearer ${emitido.body.access_token}`)
        .set('x-tenant-id', TENANT_A)
        .query({ tipo_documento: 'CC', documento: 'RA-1' });

      expect(respuesta.status).toBe(403);
    });

    it('y eligiendo `empleado`, esas mismas rutas responden 200', async () => {
      const emitido = await request(servidor())
        .post('/auth/rol-activo')
        .set('Authorization', `Bearer ${multirol.token}`)
        .send({ rol: 'empleado' });

      const respuesta = await request(servidor())
        .get('/propietarios')
        .set('Authorization', `Bearer ${emitido.body.access_token}`)
        .set('x-tenant-id', TENANT_A)
        .query({ tipo_documento: 'CC', documento: 'RA-1' });

      expect(respuesta.status).toBe(200);
    });

    it('el token con rol de cliente tampoco escribe: el POST da 403 (R23)', async () => {
      // El 403 se decide en el backend, antes de ejecutar ninguna consulta de
      // negocio. Ocultar el botón en el frontend no es autorización.
      const emitido = await request(servidor())
        .post('/auth/rol-activo')
        .set('Authorization', `Bearer ${multirol.token}`)
        .send({ rol: 'propietario' });

      const respuesta = await request(servidor())
        .post('/propietarios')
        .set('Authorization', `Bearer ${emitido.body.access_token}`)
        .set('x-tenant-id', TENANT_A)
        .send({ nombre: 'No Debe Existir', tipo_documento: 'CC', documento: 'RA-99' });

      expect(respuesta.status).toBe(403);

      const { rows } = await entorno.poolAdmin.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM perfil_propietario
          WHERE tenant_id = $1 AND documento = 'RA-99'`,
        [TENANT_A],
      );
      expect(Number(rows[0]?.total)).toBe(0);
    });

    it('R21 — la elección queda auditada con el rol, sin más datos', async () => {
      await request(servidor())
        .post('/auth/rol-activo')
        .set('Authorization', `Bearer ${multirol.token}`)
        .send({ rol: 'empleado' });

      const { rows } = await entorno.poolAdmin.query<{
        tenant_id: string;
        actor_id: string | null;
        entity_type: string;
        entity_id: string | null;
        metadata: Record<string, unknown> | null;
      }>(
        `SELECT tenant_id::text, actor_id::text, entity_type, entity_id::text, metadata
           FROM audit_log
          WHERE accion = 'auth.rol_activo_elegido' AND actor_id = $1
          ORDER BY created_at DESC LIMIT 1`,
        [multirol.id],
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]?.tenant_id).toBe(TENANT_A);
      expect(rows[0]?.actor_id).toBe(multirol.id);
      expect(rows[0]?.entity_type).toBe('user');
      expect(rows[0]?.entity_id).toBe(multirol.id);
      expect(rows[0]?.metadata).toEqual({ rol: 'empleado' });
    });
  });

  // ─── T25 — un rol que no se tiene no se elige (R17, R19, R29) ───────────

  describe('T25 — elegir un rol no poseído es 403 y no emite token', () => {
    it('403 y ningún access_token en la respuesta (R17)', async () => {
      const respuesta = await request(servidor())
        .post('/auth/rol-activo')
        .set('Authorization', `Bearer ${multirol.token}`)
        .send({ rol: 'admin' });

      expect(respuesta.status).toBe(403);
      expect(respuesta.body.error).toBe('ROL_NO_DISPONIBLE');
      expect(respuesta.body).not.toHaveProperty('access_token');
    });

    it('el 403 no revela qué roles SÍ tiene la identidad', async () => {
      const respuesta = await request(servidor())
        .post('/auth/rol-activo')
        .set('Authorization', `Bearer ${multirol.token}`)
        .send({ rol: 'admin' });

      const cuerpo = JSON.stringify(respuesta.body);
      expect(cuerpo).not.toContain('empleado');
      expect(cuerpo).not.toContain('propietario');
    });

    it('un rol ausente, vacío o no textual también es 403', async () => {
      for (const cuerpo of [{}, { rol: '' }, { rol: 42 }, { rol: null }]) {
        const respuesta = await request(servidor())
          .post('/auth/rol-activo')
          .set('Authorization', `Bearer ${multirol.token}`)
          .send(cuerpo);
        expect(respuesta.status, JSON.stringify(cuerpo)).toBe(403);
      }
    });

    it('R19 — la comprobación es contra la BASE, no contra el token', async () => {
      // Se revoca el rol en la base dejando **intacto** el token, que lo sigue
      // listando. Si la emisión se decidiera con el token, esto seguiría
      // funcionando: es exactamente la prórroga automática que R19 prohíbe.
      const { rows } = await entorno.poolAdmin.query<{ id: string }>(
        `INSERT INTO "user" (tenant_id, email, password_hash, nombre)
         VALUES ($1, 'revocable@example.com', NULL, 'Revocable') RETURNING id`,
        [TENANT_A],
      );
      const id = rows[0]!.id;
      await entorno.poolAdmin.query(
        `INSERT INTO user_role (user_id, tenant_id, rol) VALUES ($1, $2, 'empleado')`,
        [id, TENANT_A],
      );
      const token = firmar(id, 'revocable@example.com', [
        { tenant_id: TENANT_A, rol: 'empleado' },
      ]);

      const antes = await request(servidor())
        .post('/auth/rol-activo')
        .set('Authorization', `Bearer ${token}`)
        .send({ rol: 'empleado' });
      expect(antes.status).toBe(200);

      await entorno.poolAdmin.query(
        `UPDATE user_role SET activo = false WHERE user_id = $1 AND rol = 'empleado'`,
        [id],
      );

      const despues = await request(servidor())
        .post('/auth/rol-activo')
        .set('Authorization', `Bearer ${token}`)
        .send({ rol: 'empleado' });

      expect(despues.status).toBe(403);
      expect(despues.body).not.toHaveProperty('access_token');
    });

    it('R29 — un token cuyo rol_activo no figura entre sus roles da 403', async () => {
      // Token manipulado: dice actuar como `admin` sin declarar ese rol.
      const incoherente = firmar(
        multirol.id,
        'multirol-a@example.com',
        [{ tenant_id: TENANT_A, rol: 'empleado' }],
        'admin',
      );

      const respuesta = await request(servidor())
        .get('/propietarios')
        .set('Authorization', `Bearer ${incoherente}`)
        .set('x-tenant-id', TENANT_A)
        .query({ tipo_documento: 'CC', documento: 'RA-1' });

      expect(respuesta.status).toBe(403);
    });
  });

  // ─── T26 — compatibilidad hacia atrás (R20) ─────────────────────────────

  describe('T26 — un token sin rol_activo autoriza igual que antes (R20)', () => {
    it('el admin sembrado sigue alcanzando las rutas de siempre', async () => {
      const respuesta = await request(servidor())
        .get('/propietarios')
        .set('Authorization', `Bearer ${entorno.adminA.token}`)
        .set('x-tenant-id', TENANT_A)
        .query({ tipo_documento: 'CC', documento: 'RA-1' });

      expect(respuesta.status).toBe(200);
    });

    it('el empleado sembrado también, y sigue sin poder entrar en otra inmobiliaria', async () => {
      const propia = await request(servidor())
        .get('/propietarios')
        .set('Authorization', `Bearer ${entorno.empleadoA.token}`)
        .set('x-tenant-id', TENANT_A)
        .query({ tipo_documento: 'CC', documento: 'RA-1' });
      expect(propia.status).toBe(200);

      const ajena = await request(servidor())
        .get('/propietarios')
        .set('Authorization', `Bearer ${entorno.empleadoA.token}`)
        .set('x-tenant-id', TENANT_B)
        .query({ tipo_documento: 'CC', documento: 'RA-1' });
      expect(ajena.status).toBe(403);
    });

    it('un token multirol SIN elegir rol conserva el acceso de todos sus roles', async () => {
      const respuesta = await request(servidor())
        .get('/propietarios')
        .set('Authorization', `Bearer ${multirol.token}`)
        .set('x-tenant-id', TENANT_A)
        .query({ tipo_documento: 'CC', documento: 'RA-1' });

      // Tiene `empleado` entre sus roles y no ha elegido: autoriza. Es lo que
      // hacía antes de esta feature, y ningún token vigente se invalida.
      expect(respuesta.status).toBe(200);
    });

    it('quien no tiene el rol requerido sigue recibiendo 403 (sin regresión)', async () => {
      const respuesta = await request(servidor())
        .get('/propietarios')
        .set('Authorization', `Bearer ${entorno.propietarioA.token}`)
        .set('x-tenant-id', TENANT_A)
        .query({ tipo_documento: 'CC', documento: 'RA-1' });

      expect(respuesta.status).toBe(403);
    });
  });
});
