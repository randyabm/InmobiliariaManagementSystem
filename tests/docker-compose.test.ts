import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

import { leerTexto } from './support/repo';

interface Servicio {
  image?: string;
  environment?: Record<string, string>;
  command?: string[];
  ports?: string[];
  volumes?: string[];
  healthcheck?: unknown;
}

interface Compose {
  services: Record<string, Servicio>;
  volumes?: Record<string, unknown>;
}

const compose = load(leerTexto('docker-compose.yml')) as Compose;
const envExample = leerTexto('.env.example');

const SERVICIOS_REQUERIDOS = ['postgres', 'redis', 'minio'] as const;

/** Campos que, de llevar un literal, serían una credencial commiteada (R9). */
const CLAVES_SENSIBLES = [
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'REDIS_PASSWORD',
  'MINIO_ROOT_USER',
  'MINIO_ROOT_PASSWORD',
] as const;

function clavesDeclaradasEnEnvExample(): Set<string> {
  return new Set(
    envExample
      .split('\n')
      .map((linea) => linea.trim())
      .filter((linea) => linea.length > 0 && !linea.startsWith('#'))
      .map((linea) => linea.split('=')[0]?.trim() ?? ''),
  );
}

describe('Stack local declarado (R8)', () => {
  it.each(SERVICIOS_REQUERIDOS)('declara el servicio %s', (servicio) => {
    expect(compose.services[servicio]).toBeDefined();
  });

  it('ninguna imagen usa la etiqueta latest ni la omite', () => {
    for (const [nombre, servicio] of Object.entries(compose.services)) {
      const imagen = servicio.image ?? '';
      expect(imagen, `servicio ${nombre}`).not.toBe('');
      expect(imagen, `servicio ${nombre}`).toContain(':');
      expect(imagen.split(':').pop(), `servicio ${nombre}`).not.toBe('latest');
    }
  });

  it('cada servicio tiene volumen nombrado y healthcheck', () => {
    for (const [nombre, servicio] of Object.entries(compose.services)) {
      expect(servicio.healthcheck, `servicio ${nombre}`).toBeDefined();
      expect(servicio.volumes?.length, `servicio ${nombre}`).toBeGreaterThan(0);
    }
    expect(Object.keys(compose.volumes ?? {})).toEqual(
      expect.arrayContaining(['postgres-data', 'redis-data', 'minio-data']),
    );
  });
});

describe('Sin credenciales literales en el compose (R9, CHECKPOINTS §C7)', () => {
  it('todo valor sensible es una interpolación ${VAR}', () => {
    for (const [nombre, servicio] of Object.entries(compose.services)) {
      for (const [clave, valor] of Object.entries(servicio.environment ?? {})) {
        expect(String(valor), `${nombre}.${clave}`).toMatch(
          /^\$\{[A-Z0-9_]+\}$/,
        );
      }
    }
  });

  it('las contraseñas usadas en `command` también son interpolaciones', () => {
    const serializado = JSON.stringify(compose.services);
    // Cualquier `password` seguida de un literal sería una credencial.
    expect(serializado).not.toMatch(/--requirepass["',\s]+(?!\$\{)[^"',\s]+/);
  });

  it.each(CLAVES_SENSIBLES)(
    '%s está declarada en .env.example con un placeholder',
    (clave) => {
      expect(clavesDeclaradasEnEnvExample()).toContain(clave);
    },
  );

  it('.env.example no contiene valores reales', () => {
    const valores = envExample
      .split('\n')
      .filter((linea) =>
        CLAVES_SENSIBLES.some((c) => linea.startsWith(`${c}=`)),
      )
      .map((linea) => linea.split('=').slice(1).join('=').trim());

    expect(valores.length).toBe(CLAVES_SENSIBLES.length);
    for (const valor of valores) {
      expect(valor).toBe('CHANGE_ME');
    }
  });

  it('todas las variables interpoladas por el compose existen en .env.example', () => {
    const declaradas = clavesDeclaradasEnEnvExample();
    const usadas = [
      ...leerTexto('docker-compose.yml').matchAll(/\$\{([A-Z0-9_]+)\}/g),
    ].map((coincidencia) => coincidencia[1] ?? '');

    for (const variable of new Set(usadas)) {
      expect(declaradas, `variable ${variable}`).toContain(variable);
    }
  });
});
