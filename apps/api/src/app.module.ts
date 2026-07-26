import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ConfigModule } from './config';
import { CoreModule } from './modules/core/core.module';

/**
 * Módulo raíz. Monolito modular (D1): un solo despliegue, un módulo por
 * paquete comercial bajo `modules/`.
 *
 * El filtro global se registra aquí (y no solo en `main.ts`) para que los
 * tests que arrancan la app con `Test.createTestingModule` ejerciten
 * exactamente el mismo manejo de errores que producción (R16).
 */
@Module({
  imports: [ConfigModule, CoreModule],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
