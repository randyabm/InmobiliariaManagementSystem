import type { INestApplication } from '@nestjs/common';

import { buildCorsOptions } from './common/cors/cors-options';
import { FrameAncetorsPorTenantInterceptor } from './common/headers/frame-ancestors-por-tenant.interceptor';
import { SeguridadHeadersInterceptor } from './common/headers/seguridad-headers.interceptor';
import type { AppConfig } from './config';

/**
 * Aplica a la instancia de Nest todo lo que NO vive en un módulo.
 *
 * Existe como función exportada —y no como código suelto dentro de
 * `bootstrap()`— para que los tests de humo configuren la app **igual** que
 * producción. Si esto viviera solo en `main.ts`, los tests probarían una app
 * distinta de la que se despliega.
 */
export function configureApp(app: INestApplication, config: AppConfig): void {
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.disable('x-powered-by');
  app.enableCors(buildCorsOptions(config));
  app.useGlobalInterceptors(
    new SeguridadHeadersInterceptor(),
    new FrameAncetorsPorTenantInterceptor(),
  );
}
