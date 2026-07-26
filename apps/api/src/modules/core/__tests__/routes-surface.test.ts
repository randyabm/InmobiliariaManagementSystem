import type { INestApplication, Type } from '@nestjs/common';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryModule, DiscoveryService } from '@nestjs/core';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { crearAppDePrueba } from '../../../../test/support/create-test-app';
import { usarEntornoDePrueba } from '../../../../test/support/test-env';

/**
 * Superficie HTTP pública permitida en esta fase (R16).
 *
 * Cualquier endpoint nuevo obliga a actualizar esta lista *y* a añadirle sus
 * tres tests (camino feliz autorizado, rechazo por rol, rechazo por tenant
 * ajeno) en cuanto existan roles y tenants (features #2 y #3).
 */
const RUTAS_PERMITIDAS = ['GET /auth/me', 'GET /health', 'POST /auth/login'] as const;

function normalizar(segmento: unknown): string {
  const valor = typeof segmento === 'string' ? segmento : '';
  return valor.replace(/^\/+|\/+$/g, '');
}

/** Enumera las rutas realmente registradas en el contenedor de NestJS. */
function enumerarRutas(app: INestApplication): string[] {
  const discovery = app.get(DiscoveryService);
  const rutas: string[] = [];

  for (const wrapper of discovery.getControllers()) {
    const metatype = wrapper.metatype as Type<object> | undefined;
    if (!metatype) continue;

    const prefijo = normalizar(Reflect.getMetadata(PATH_METADATA, metatype));
    const prototipo = metatype.prototype as Record<string, unknown>;

    for (const nombre of Object.getOwnPropertyNames(prototipo)) {
      if (nombre === 'constructor') continue;
      const handler = prototipo[nombre];
      if (typeof handler !== 'function') continue;

      const metodo = Reflect.getMetadata(METHOD_METADATA, handler) as
        number | undefined;
      if (metodo === undefined) continue;

      const sufijo = normalizar(Reflect.getMetadata(PATH_METADATA, handler));
      const ruta = ['', prefijo, sufijo].filter(Boolean).join('/');
      rutas.push(`${RequestMethod[metodo]} /${ruta.replace(/^\/+/, '')}`);
    }
  }

  return rutas.sort();
}

describe('Superficie HTTP expuesta (R16)', () => {
  let app: INestApplication;
  let restaurarEntorno: () => void;

  beforeAll(async () => {
    restaurarEntorno = usarEntornoDePrueba();
    app = await crearAppDePrueba({ imports: [DiscoveryModule] });
  });

  afterAll(async () => {
    await app.close();
    restaurarEntorno();
  });

  it('no registra ninguna ruta fuera de la lista blanca', () => {
    expect(enumerarRutas(app)).toEqual([...RUTAS_PERMITIDAS].sort());
  });

  it('una ruta inexistente devuelve 404 en español y sin traza de pila', async () => {
    const respuesta = await request(app.getHttpServer()).get(
      '/propiedades/secretas',
    );

    expect(respuesta.status).toBe(404);
    expect(respuesta.body.message).toBe('El recurso solicitado no existe.');
    expect(respuesta.body.error).toBe('RESOURCE_NOT_FOUND');
    expect(respuesta.body).not.toHaveProperty('stack');

    const serializado = JSON.stringify(respuesta.body);
    expect(serializado).not.toContain('Cannot GET');
    expect(serializado).not.toMatch(/\.ts:\d+|node_modules|at Object\./);
  });

  it('un método no soportado tampoco filtra texto del framework', async () => {
    const respuesta = await request(app.getHttpServer()).post('/health');

    expect(respuesta.status).toBe(404);
    expect(JSON.stringify(respuesta.body)).not.toContain('Cannot POST');
  });
});
