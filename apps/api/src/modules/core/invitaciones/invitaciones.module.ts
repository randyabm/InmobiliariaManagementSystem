import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { InvitacionesController } from './invitaciones.controller';
import { InvitacionesRepository } from './invitaciones.repository';
import { InvitacionesService } from './invitaciones.service';

/**
 * Invitación de revisión (feature #13, R1, R2, R3).
 *
 * La generación es admin/empleado; el bootstrap (`GET /invitaciones/:token`)
 * es la única ruta pública previa al contexto y revalida DENTRO del RLS
 * (PA-13-4). El registro de la cuenta vive en `OtpModule`.
 */
@Module({
  imports: [AuditModule],
  controllers: [InvitacionesController],
  providers: [InvitacionesRepository, InvitacionesService],
  exports: [InvitacionesService, InvitacionesRepository],
})
export class InvitacionesModule {}
