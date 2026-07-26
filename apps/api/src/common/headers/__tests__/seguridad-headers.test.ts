import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { crearAppDePrueba } from '../../../../test/support/create-test-app';
import { usarEntornoDePrueba } from '../../../../test/support/test-env';

describe('Cabeceras de seguridad HTTP (R7)', () => {
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

  it('no emite X-Powered-By (R1)', async () => {
    const respuesta = await request(app.getHttpServer()).get('/health');

    expect(respuesta.headers['x-powered-by']).toBeUndefined();
  });

  it('emite Strict-Transport-Security (R2)', async () => {
    const respuesta = await request(app.getHttpServer()).get('/health');

    expect(respuesta.headers['strict-transport-security']).toBe(
      'max-age=31536000; includeSubDomains',
    );
  });

  it('emite X-Content-Type-Options: nosniff (R3)', async () => {
    const respuesta = await request(app.getHttpServer()).get('/health');

    expect(respuesta.headers['x-content-type-options']).toBe('nosniff');
  });

  it('emite Referrer-Policy (R4)', async () => {
    const respuesta = await request(app.getHttpServer()).get('/health');

    expect(respuesta.headers['referrer-policy']).toBe(
      'strict-origin-when-cross-origin',
    );
  });

  it('emite Content-Security-Policy con default-src self (R5)', async () => {
    const respuesta = await request(app.getHttpServer()).get('/health');

    expect(respuesta.headers['content-security-policy']).toContain(
      "default-src 'self'",
    );
  });
});
