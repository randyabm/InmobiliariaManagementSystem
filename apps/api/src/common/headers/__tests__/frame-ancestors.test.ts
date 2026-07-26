import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { crearAppDePrueba } from '../../../../test/support/create-test-app';
import { usarEntornoDePrueba } from '../../../../test/support/test-env';

describe('frame-ancestors por tenant (R8)', () => {
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

  it('usa frame-ancestors self por defecto sin origin', async () => {
    const respuesta = await request(app.getHttpServer()).get('/health');

    expect(respuesta.headers['content-security-policy']).toContain(
      "frame-ancestors 'self'",
    );
  });

  it('permite un origin registrado en frame-ancestors (R6)', async () => {
    const respuesta = await request(app.getHttpServer())
      .get('/health')
      .set('Origin', 'https://portal.inmobiliaria1.com');

    expect(respuesta.headers['content-security-policy']).toContain(
      "frame-ancestors 'https://portal.inmobiliaria1.com'",
    );
  });

  it('rechaza un origin no registrado, mantiene self (R8)', async () => {
    const respuesta = await request(app.getHttpServer())
      .get('/health')
      .set('Origin', 'https://evil.example.com');

    expect(respuesta.headers['content-security-policy']).toContain(
      "frame-ancestors 'self'",
    );
    expect(respuesta.headers['content-security-policy']).not.toContain(
      'evil.example.com',
    );
  });
});
