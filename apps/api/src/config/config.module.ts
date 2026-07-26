import { Global, Module } from '@nestjs/common';

import { APP_CONFIG, loadAppConfig, type AppConfig } from './app-config';

/**
 * Configuración validada, disponible en toda la aplicación.
 *
 * Se valida una sola vez, en el arranque (R17): si el entorno es inválido la
 * app no llega a escuchar en el puerto.
 */
@Global()
@Module({
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: (): AppConfig => loadAppConfig(),
    },
  ],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
