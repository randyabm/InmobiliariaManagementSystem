import { Module } from '@nestjs/common';

import { HealthController } from './health/health.controller';
import { HealthService } from './health/health.service';
import { AuthModule } from './auth/auth.module';
import { AuditModule } from './audit/audit.module';
import { AlmacenamientoModule } from './almacenamiento/almacenamiento.module';
import { ClientesModule } from './clientes/clientes.module';
import { PropiedadesModule } from './propiedades/propiedades.module';
import { WorkflowsModule } from './workflows/workflows.module';
import { NotificacionesModule } from './notificaciones/notificaciones.module';
import { PlantillasModule } from './plantillas/plantillas.module';

/**
 * Módulo transversal: tenant, auth, usuarios, roles y auditoría viven aquí
 * (docs/architecture.md). `core/` NO depende de ningún otro módulo; todos los
 * demás dependen de él.
 *
 * Contiene healthcheck (#1), auth (#3), auditoría (#4), la hoja de vida de
 * propietario e inquilino (#5, `ClientesModule`), el almacenamiento
 * compartido (#6, `AlmacenamientoModule`) y la hoja de vida del inmueble
 * (#6, `PropiedadesModule`) y el motor de workflows
 * (#7, `WorkflowsModule`).
 */
@Module({
  imports: [
    AuthModule,
    AuditModule,
    AlmacenamientoModule,
    ClientesModule,
    PropiedadesModule,
    WorkflowsModule,
    NotificacionesModule,
    PlantillasModule,
  ],
  controllers: [HealthController],
  providers: [HealthService],
  exports: [
    HealthService,
    AuthModule,
    AuditModule,
    ClientesModule,
    PropiedadesModule,
    WorkflowsModule,
    NotificacionesModule,
    PlantillasModule,
  ],
})
export class CoreModule {}
