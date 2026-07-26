import { afterEach, describe, expect, it } from 'vitest';

import { crearAppDePrueba } from '../../test/support/create-test-app';
import { usarEntornoDePrueba } from '../../test/support/test-env';
import { APP_VERSION } from '../app-version';
import packageJson from '../../package.json';

describe('Aplicación NestJS de apps/api (R2)', () => {
  let restaurar: (() => void) | undefined;

  afterEach(() => {
    restaurar?.();
    restaurar = undefined;
  });

  it('el módulo raíz compone y la aplicación arranca', async () => {
    restaurar = usarEntornoDePrueba();

    const app = await crearAppDePrueba();
    expect(app).toBeDefined();
    await app.close();
  });
});

describe('Versión expuesta por el healthcheck (R13)', () => {
  it('APP_VERSION coincide con la versión del manifiesto de apps/api', () => {
    expect(APP_VERSION).toBe(packageJson.version);
  });
});
