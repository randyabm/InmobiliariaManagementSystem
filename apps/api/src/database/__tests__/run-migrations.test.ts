import { describe, expect, it } from 'vitest';

import { ConfigurationError } from '../../common/errors';
import {
  MENSAJE_SIN_DOCKER,
  assertDockerDisponible,
} from '../../../test/support/docker-guard';
import { readDatabaseUrl } from '../run-migrations';
import { hasActiveDatabasePool } from '../database.client';

describe('Runner de migraciones (R10, R17)', () => {
  it('aborta con ConfigurationError si falta DATABASE_URL', () => {
    let capturado: unknown;
    try {
      readDatabaseUrl({});
    } catch (error) {
      capturado = error;
    }

    expect(capturado).toBeInstanceOf(ConfigurationError);
    expect((capturado as ConfigurationError).variables).toContain(
      'DATABASE_URL',
    );
  });

  it('trata una DATABASE_URL en blanco como ausente', () => {
    expect(() => readDatabaseUrl({ DATABASE_URL: '   ' })).toThrow(
      ConfigurationError,
    );
  });

  it('devuelve la cadena de conexión cuando está definida', () => {
    expect(
      readDatabaseUrl({ DATABASE_URL: 'postgres://u:p@localhost:5432/db' }),
    ).toBe('postgres://u:p@localhost:5432/db');
  });

  it('importar el cliente de base de datos no abre ninguna conexión (R14)', () => {
    expect(hasActiveDatabasePool()).toBe(false);
  });
});

describe('Guarda de la suite de base de datos (R19)', () => {
  it('falla con un motivo explícito cuando el runtime no está disponible', async () => {
    await expect(
      assertDockerDisponible(() =>
        Promise.reject(new Error('Cannot connect to the Docker daemon')),
      ),
    ).rejects.toThrow(MENSAJE_SIN_DOCKER);
  });

  it('el mensaje dice que la suite NO se omite en silencio', () => {
    expect(MENSAJE_SIN_DOCKER).toContain('Docker no disponible');
    expect(MENSAJE_SIN_DOCKER).toContain('Testcontainers');
  });

  it('no falla cuando el runtime responde', async () => {
    await expect(
      assertDockerDisponible(() => Promise.resolve({})),
    ).resolves.toBeUndefined();
  });
});
