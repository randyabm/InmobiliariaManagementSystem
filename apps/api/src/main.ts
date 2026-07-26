import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { APP_CONFIG, type AppConfig } from './config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Si el entorno es inválido, `ConfigModule` ya ha lanzado
  // `ConfigurationError` durante la creación de la app: no llegamos aquí (R17).
  const config = app.get<AppConfig>(APP_CONFIG);

  configureApp(app, config);
  app.enableShutdownHooks();

  await app.listen(config.port);
  new Logger('Bootstrap').log(`API escuchando en el puerto ${config.port}`);
}

void bootstrap();
