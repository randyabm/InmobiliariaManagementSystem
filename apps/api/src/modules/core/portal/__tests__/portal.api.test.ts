import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type EntornoClientes,
  levantarEntornoClientes,
  TENANT_A,
} from '../../../../../test/support/entorno-clientes';

/**
 * Portales embebibles (T2–T7 → R2–R6, §6.6, D7).
 */
describe('Portales embebibles (#32)', () => {
  let entorno: EntornoClientes;
  let idDominio: string;
  let handshake: string;

  beforeAll(async () => {
    entorno = await levantarEntornoClientes();
    const { rows } = await entorno.poolAdmin.query<{ id: string }>(
      `INSERT INTO tenant_dominio (tenant_id, dominio, paquete_web, logo_url, colores_json)
       VALUES ($1, 'portal.demo.com', 'web_completo', 'https://x/logo.png',
               '{"primario":"#0f4c81"}')
       RETURNING id`,
      [TENANT_A],
    );
    idDominio = rows[0]?.id ?? '';
  }, 180_000);

  afterAll(async () => {
    await entorno?.cerrar();
  });

  const servidor = () => entorno.app.getHttpServer();
  const comoAdminA = (metodo: 'post' | 'get', ruta: string) =>
    request(servidor())
      [metodo](ruta)
      .set('Authorization', `Bearer ${entorno.adminA.token}`)
      .set('x-tenant-id', TENANT_A);

  // ─── R4 — configuración pública ─────────────────────────────────────────

  describe('R4 — config (RF-INT5, white-label)', () => {
    it('GET /portal/config devuelve el theming del tenant', async () => {
      const respuesta = await comoAdminA('get', '/portal/config?dominio=portal.demo.com');
      expect(respuesta.status).toBe(200);
      expect(respuesta.body.logo_url).toBe('https://x/logo.png');
      expect(respuesta.body.colores.primario).toBe('#0f4c81');
    });

    it('dominio no registrado → 404', async () => {
      const respuesta = await comoAdminA('get', '/portal/config?dominio=otro.com');
      expect(respuesta.status).toBe(404);
    });
  });

  // ─── R2 — handshake SSO ─────────────────────────────────────────────────

  describe('R2 — handshake SSO (RF-INT3, RF-INT6)', () => {
    it('canjear un handshake válido devuelve el access token del rol', async () => {
      // El handshake se firma con el secreto del sistema (mismo JWT).
      const jwt = (await import('jsonwebtoken')) as typeof import('jsonwebtoken');
      const { JWT_SECRET_DE_PRUEBA } = await import(
        '../../../../../test/support/entorno-clientes'
      );
      handshake = jwt.sign(
        {
          dominio: 'portal.demo.com',
          sub: entorno.inquilinoA.id,
          roles: [{ tenant_id: TENANT_A, rol: 'inquilino' }],
          jti: 'sso-1',
          exp: Math.floor(Date.now() / 1000) + 300,
        },
        JWT_SECRET_DE_PRUEBA,
      );

      const respuesta = await comoAdminA('post', '/portal/sso').send({ token: handshake });
      expect(respuesta.status).toBe(201);
      expect(respuesta.body.rol).toBe('inquilino');
      expect(respuesta.body.access_token).toBeTruthy();
    });

    it('token inválido → 401/404 uniforme (R6)', async () => {
      const respuesta = await comoAdminA('post', '/portal/sso').send({
        token: 'no-es-un-token',
      });
      expect(respuesta.status).toBe(404);
    });

    it('feature flag: rol no cubierto por el paquete → rechazado (R5)', async () => {
      const jwt = (await import('jsonwebtoken')) as typeof import('jsonwebtoken');
      const { JWT_SECRET_DE_PRUEBA } = await import(
        '../../../../../test/support/entorno-clientes'
      );
      await entorno.poolAdmin.query(
        `UPDATE tenant_dominio SET paquete_web = 'portal_propietario' WHERE id = $1`,
        [idDominio],
      );
      const handshakeNoCubierto = jwt.sign(
        {
          dominio: 'portal.demo.com',
          sub: entorno.inquilinoA.id,
          roles: [{ tenant_id: TENANT_A, rol: 'inquilino' }],
          jti: 'sso-2',
          exp: Math.floor(Date.now() / 1000) + 300,
        },
        JWT_SECRET_DE_PRUEBA,
      );
      const respuesta = await comoAdminA('post', '/portal/sso').send({
        token: handshakeNoCubierto,
      });
      expect(respuesta.status).toBe(404);

      // Restaurar el paquete.
      await entorno.poolAdmin.query(
        `UPDATE tenant_dominio SET paquete_web = 'web_completo' WHERE id = $1`,
        [idDominio],
      );
    });

    it('sin token → 401', async () => {
      const respuesta = await request(servidor())
        .post('/portal/sso')
        .send({ token: 'x' })
        .set('x-tenant-id', TENANT_A);
      expect(respuesta.status).toBe(401);
    });
  });
});
