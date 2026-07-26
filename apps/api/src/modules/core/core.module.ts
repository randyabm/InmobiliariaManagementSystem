import { Module } from '@nestjs/common';

import { HealthController } from './health/health.controller';
import { HealthService } from './health/health.service';

/**
 * Módulo transversal: tenant, auth, usuarios, roles y auditoría vivirán aquí
 * (docs/architecture.md). `core/` NO depende de ningún otro módulo; todos los
 * demás dependen de él.
 *
 * Hoy solo contiene el healthcheck; las features #2, #3 y #4 lo pueblan.
 */
@Module({
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService],
})
export class CoreModule {}
