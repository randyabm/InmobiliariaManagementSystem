import { Module } from '@nestjs/common';

import { HealthController } from './health/health.controller';
import { HealthService } from './health/health.service';
import { AuthModule } from './auth/auth.module';
import { AuditModule } from './audit/audit.module';

/**
 * Módulo transversal: tenant, auth, usuarios, roles y auditoría vivirán aquí
 * (docs/architecture.md). `core/` NO depende de ningún otro módulo; todos los
 * demás dependen de él.
 *
 * Hoy contiene healthcheck, auth y auditoría; las features #2 lo pueblan.
 */
@Module({
  imports: [AuthModule, AuditModule],
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService, AuthModule, AuditModule],
})
export class CoreModule {}
