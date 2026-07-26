import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { crearAppDePrueba } from '../../../../../test/support/create-test-app';
import { usarEntornoDePrueba } from '../../../../../test/support/test-env';
import { hasActiveDatabasePool } from '../../../../database';
import { APP_VERSION } from '../../../../app-version';

describe('GET /health (test de humo, R13 y R14)', () => {
  let app: INestApplication;
  let restaurarEntorno: () => void;

  beforeAll(async () => {
    restaurarEntorno = usarEntornoDePrueba();
    app = await crearAppDePrueba();
  });

  afterAll(async () => {
    await app.close();
    restaurarEntorno();
  });

  it('responde 200 con status "ok" y la versión de la aplicación', async () => {
    const respuesta = await request(app.getHttpServer()).get('/health');

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.status).toBe('ok');
    expect(respuesta.body.version).toBe(APP_VERSION);
    expect(typeof respuesta.body.uptime).toBe('number');
    expect(respuesta.body.uptime).toBeGreaterThanOrEqual(0);
  });

  it('responde sin PostgreSQL, Redis ni MinIO levantados y sin abrir conexión', async () => {
    // La cadena de `DATABASE_URL` apunta a un host donde no hay nada
    // escuchando. Si el healthcheck intentara conectarse, esto fallaría por
    // timeout o por ECONNREFUSED.
    const respuesta = await request(app.getHttpServer()).get('/health');

    expect(respuesta.status).toBe(200);
    // Prueba positiva de que el arranque no abrió el pool (R14): no basta con
    // que la petición devuelva 200.
    expect(hasActiveDatabasePool()).toBe(false);
  });
});
