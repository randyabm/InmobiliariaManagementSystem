import { Module } from '@nestjs/common';

import { HealthController } from './health/health.controller';
import { HealthService } from './health/health.service';
import { AuthModule } from './auth/auth.module';
import { AuditModule } from './audit/audit.module';
import { ClientesModule } from './clientes/clientes.module';

/**
 * Módulo transversal: tenant, auth, usuarios, roles y auditoría viven aquí
 * (docs/architecture.md). `core/` NO depende de ningún otro módulo; todos los
 * demás dependen de él.
 *
 * Contiene healthcheck (#1), auth (#3), auditoría (#4) y la hoja de vida de
 * propietario e inquilino (#5, `ClientesModule`).
 */
@Module({
  imports: [AuthModule, AuditModule, ClientesModule],
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService, AuthModule, AuditModule, ClientesModule],
})
export class CoreModule {}
