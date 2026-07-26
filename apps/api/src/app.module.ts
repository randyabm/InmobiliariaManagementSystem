import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';

import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { TenantContextInterceptor } from './common/interceptors/tenant-context.interceptor';
import { ConfigModule } from './config';
import { CoreModule } from './modules/core/core.module';

/**
 * Módulo raíz. Monolito modular (D1): un solo despliegue, un módulo por
 * paquete comercial bajo `modules/`.
 *
 * El filtro global se registra aquí (y no solo en `main.ts`) para que los
 * tests que arrancan la app con `Test.createTestingModule` ejerciten
 * exactamente el mismo manejo de errores que producción (R16).
 *
 * `TenantContextInterceptor` se registra aquí desde la feature #5 (T13). Sin
 * este registro, `SET LOCAL app.current_tenant` no se ejecutaba nunca y las
 * políticas de RLS no tenían contra qué filtrar: era deuda abierta de las
 * features #2/#3 (design.md §1).
 */
@Module({
  imports: [ConfigModule, CoreModule],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
  ],
})
export class AppModule {}
