import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { crearAppDePrueba } from '../../../../../test/support/create-test-app';
import { usarEntornoDePrueba } from '../../../../../test/support/test-env';
import { HealthService } from '../health.service';

/**
 * Lista blanca EXACTA de claves de `GET /health` (R15).
 *
 * Si alguien añade un campo —la cadena de conexión "para depurar", el
 * `tenant_id`, la versión de PostgreSQL— este test falla. Es el control que
 * impide que una sonda pública se convierta en una fuga de información.
 */
const CLAVES_PERMITIDAS = ['status', 'version', 'uptime'] as const;

/** Fragmentos que jamás deben aparecer en el cuerpo serializado. */
const FRAGMENTOS_PROHIBIDOS = [
  'postgres://',
  'redis://',
  'DATABASE_URL',
  'CORS_ORIGINS',
  'password',
  'tenant',
  'secret',
];

describe('Contrato de seguridad de GET /health (R15)', () => {
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

  it('devuelve exactamente las claves de la lista blanca, sin extras', async () => {
    const respuesta = await request(app.getHttpServer()).get('/health');

    expect(Object.keys(respuesta.body).sort()).toEqual(
      [...CLAVES_PERMITIDAS].sort(),
    );
  });

  it('no filtra entorno, credenciales ni identificadores de tenant', async () => {
    const respuesta = await request(app.getHttpServer()).get('/health');
    const serializado = JSON.stringify(respuesta.body).toLowerCase();

    for (const fragmento of FRAGMENTOS_PROHIBIDOS) {
      expect(serializado).not.toContain(fragmento.toLowerCase());
    }
  });

  it('el servicio devuelve la misma forma que el endpoint', () => {
    const estado = new HealthService().getStatus();

    expect(Object.keys(estado).sort()).toEqual([...CLAVES_PERMITIDAS].sort());
    expect(estado.status).toBe('ok');
  });
});
