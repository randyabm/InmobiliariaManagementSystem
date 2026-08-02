import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type EntornoClientes,
  levantarEntornoClientes,
  TENANT_A,
} from '../../../../../test/support/entorno-clientes';

/**
 * CORS por tenant (RF-INT4, #32): el Origin registrado en `tenant_dominio`
 * se permite aunque no esté en CORS_ORIGINS; los no registrados quedan
 * bloqueados (sin cabeceras CORS).
 */
describe('CORS por tenant (RF-INT4)', () => {
  let entorno: EntornoClientes;

  beforeAll(async () => {
    entorno = await levantarEntornoClientes();
    await entorno.poolAdmin.query(
      `INSERT INTO tenant_dominio (tenant_id, dominio, paquete_web)
       VALUES ($1, 'portal.registrado.com', 'web_completo')`,
      [TENANT_A],
    );
  }, 180_000);

  afterAll(async () => {
    await entorno?.cerrar();
  });

  const servidor = () => entorno.app.getHttpServer();

  it('preflight desde un dominio registrado del tenant → permitido', async () => {
    const respuesta = await request(servidor())
      .options('/auth/login')
      .set('Origin', 'https://portal.registrado.com')
      .set('Access-Control-Request-Method', 'POST');
    expect(respuesta.status).toBe(204);
    expect(respuesta.headers['access-control-allow-origin']).toBe(
      'https://portal.registrado.com',
    );
  });

  it('preflight desde un origen NO registrado → sin cabeceras CORS (bloqueado)', async () => {
    const respuesta = await request(servidor())
      .options('/auth/login')
      .set('Origin', 'https://sitio-ajeno.com')
      .set('Access-Control-Request-Method', 'POST');
    // El middleware rechaza la petición (403/404): lo que importa para el
    // navegador es que NO hay cabeceras CORS.
    expect([403, 404]).toContain(respuesta.status);
    expect(respuesta.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('el dominio configurado en CORS_ORIGINS sigue funcionando (camino rápido)', async () => {
    const respuesta = await request(servidor())
      .options('/auth/login')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST');
    expect(respuesta.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });
});
