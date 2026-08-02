import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { crearAppDePrueba } from '../../../../test/support/create-test-app';
import {
  ENTORNO_DE_PRUEBA,
  usarEntornoDePrueba,
} from '../../../../test/support/test-env';
import { ConfigurationError } from '../../errors';
import { loadAppConfig } from '../../../config';
import { buildCorsOptions } from '../cors-options';

describe('Configuración de CORS (R18)', () => {
  it('produce una función de resolución (lista explícita + CORS por tenant)', () => {
    const opciones = buildCorsOptions(loadAppConfig({ ...ENTORNO_DE_PRUEBA }));

    // Desde #32 (RF-INT4) el origin es un callback: lista configurada
    // (camino rápido) + `tenant_dominio_por_origen` para dominios del
    // tenant. El comodín y `true` siguen prohibidos por construcción.
    expect(typeof opciones.origin).toBe('function');
    expect(opciones.origin).not.toBe(true);
    expect(opciones.origin).not.toBe('*');
  });

  it('rechaza una configuración construida a mano con "*"', () => {
    expect(() =>
      buildCorsOptions({
        nodeEnv: 'test',
        port: 3000,
        databaseUrl: 'postgres://u@h/d',
        corsOrigins: ['*'],
      }),
    ).toThrow(ConfigurationError);
  });

  it('rechaza una lista vacía en vez de degradar a "cualquier origen"', () => {
    expect(() =>
      buildCorsOptions({
        nodeEnv: 'test',
        port: 3000,
        databaseUrl: 'postgres://u@h/d',
        corsOrigins: [],
      }),
    ).toThrow(ConfigurationError);
  });
});

describe('CORS aplicado a la aplicación real (R18)', () => {
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

  it('nunca responde con Access-Control-Allow-Origin: *', async () => {
    const permitido = await request(app.getHttpServer())
      .get('/health')
      .set('Origin', 'http://localhost:5173');

    expect(permitido.headers['access-control-allow-origin']).toBe(
      'http://localhost:5173',
    );

    const ajeno = await request(app.getHttpServer())
      .get('/health')
      .set('Origin', 'https://atacante.example.com');

    expect(ajeno.headers['access-control-allow-origin']).toBeUndefined();
  });
});
