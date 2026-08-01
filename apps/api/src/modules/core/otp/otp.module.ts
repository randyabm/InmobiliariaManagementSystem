import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { ClientesModule } from '../clientes/clientes.module';
import { InvitacionesModule } from '../invitaciones/invitaciones.module';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';
import { OtpController } from './otp.controller';
import { OtpRepository } from './otp.repository';
import { OtpService } from './otp.service';
import { RegistroInvitacionService } from './registro-invitacion.service';

/**
 * OTP y registro desde invitación (feature #13, R4, R5, R8).
 *
 * `OtpService` se exporta porque #14 (firma) exigirá un OTP `FIRMA` recién
 * verificado (R8).
 */
@Module({
  imports: [AuditModule, ClientesModule, NotificacionesModule, InvitacionesModule],
  controllers: [OtpController],
  providers: [OtpRepository, OtpService, RegistroInvitacionService],
  exports: [OtpService],
})
export class OtpModule {}
