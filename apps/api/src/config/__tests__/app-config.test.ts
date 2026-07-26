import { describe, expect, it } from 'vitest';

import { ConfigurationError } from '../../common/errors';
import { ENTORNO_DE_PRUEBA } from '../../../test/support/test-env';
import { loadAppConfig } from '../app-config';

const VARIABLES_REQUERIDAS = [
  'NODE_ENV',
  'PORT',
  'DATABASE_URL',
  'CORS_ORIGINS',
] as const;

function entornoSin(variable: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...ENTORNO_DE_PRUEBA };
  delete env[variable];
  return env;
}

describe('Validación de configuración (R17)', () => {
  it('acepta un entorno completo y devuelve la configuración tipada', () => {
    const config = loadAppConfig({ ...ENTORNO_DE_PRUEBA });

    expect(config.nodeEnv).toBe('test');
    expect(config.port).toBe(3000);
    expect(config.corsOrigins).toEqual([
      'http://localhost:5173',
      'https://panel.example.com',
    ]);
  });

  it.each(VARIABLES_REQUERIDAS)(
    'aborta con ConfigurationError si falta %s, nombrándola',
    (variable) => {
      let capturado: unknown;
      try {
        loadAppConfig(entornoSin(variable));
      } catch (error) {
        capturado = error;
      }

      expect(capturado).toBeInstanceOf(ConfigurationError);
      const error = capturado as ConfigurationError;
      expect(error.variables).toContain(variable);
      expect(error.message).toContain(variable);
    },
  );

  it('no aplica ningún valor por defecto cuando falta DATABASE_URL', () => {
    // R17 exige abortar, no arrancar con un default inseguro: la única forma
    // de comprobarlo es que NO devuelva configuración alguna.
    expect(() => loadAppConfig(entornoSin('DATABASE_URL'))).toThrow(
      ConfigurationError,
    );
  });

  it('rechaza CORS_ORIGINS con comodín (R18)', () => {
    expect(() =>
      loadAppConfig({ ...ENTORNO_DE_PRUEBA, CORS_ORIGINS: '*' }),
    ).toThrow(ConfigurationError);
  });

  it('las variables de Redis y MinIO son opcionales en esta fase', () => {
    const config = loadAppConfig({ ...ENTORNO_DE_PRUEBA });

    expect(config.redisUrl).toBeUndefined();
    expect(config.minioEndpoint).toBeUndefined();
  });

  it('el mensaje de error no revela el valor de la variable', () => {
    let capturado: unknown;
    try {
      loadAppConfig({ ...ENTORNO_DE_PRUEBA, DATABASE_URL: 'mysql://u:p@h/d' });
    } catch (error) {
      capturado = error;
    }

    expect(capturado).toBeInstanceOf(ConfigurationError);
    expect((capturado as Error).message).not.toContain('mysql://u:p@h/d');
  });
});
