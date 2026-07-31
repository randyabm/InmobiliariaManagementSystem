import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { APP_CONFIG, type AppConfig } from './config';
import { verificarRolDeAplicacion } from './database/verificar-rol-de-aplicacion';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Si el entorno es inválido, `ConfigModule` ya ha lanzado
  // `ConfigurationError` durante la creación de la app: no llegamos aquí (R17).
  const config = app.get<AppConfig>(APP_CONFIG);

  // R44 (hallazgo B3): si el rol de la conexión puede saltarse el RLS, la
  // aplicación NO arranca. Va antes de `listen` a propósito: un despliegue con
  // la cadena del superusuario debe fallar de inmediato y en voz alta, no
  // servir peticiones con el aislamiento por tenant desactivado en silencio.
  await verificarRolDeAplicacion(config.databaseUrl);

  configureApp(app, config);
  app.enableShutdownHooks();

  await app.listen(config.port);
  new Logger('Bootstrap').log(`API escuchando en el puerto ${config.port}`);
}

void bootstrap();
