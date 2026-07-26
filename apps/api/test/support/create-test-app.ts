import type { INestApplication, ModuleMetadata } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { APP_CONFIG, type AppConfig } from '../../src/config';

/**
 * Arranca la aplicación NestJS **real** (sin mocks del framework) configurada
 * exactamente igual que en producción, vía `configureApp`.
 *
 * docs/verification.md Nivel 3: si el módulo raíz no compone, el test falla.
 */
export async function crearAppDePrueba(
  extraMetadata: ModuleMetadata = {},
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule, ...(extraMetadata.imports ?? [])],
    controllers: extraMetadata.controllers ?? [],
    providers: extraMetadata.providers ?? [],
  }).compile();

  // `logger: false` solo silencia la SALIDA del logger: el filtro global de
  // excepciones se sigue ejecutando igual. Sin esto, cada test de 404 imprime
  // la traza técnica (que es correcto en producción) y ensucia la salida de
  // `./init.sh` hasta parecer un fallo.
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app, app.get<AppConfig>(APP_CONFIG));
  await app.init();
  return app;
}
