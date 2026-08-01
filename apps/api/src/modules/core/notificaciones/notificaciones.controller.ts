import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { NotificacionEnviada, NotificacionPendiente, NotificacionProgramada } from '@inmobiliaria/types';

import { construirContextoPeticion } from '../../../common/database/cliente-tenant';
import { ZodValidationPipe } from '../../../common/validation/zod-validation.pipe';
import { Audit } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  type EnviarNotificacionDto,
  type ProgramarNotificacionDto,
  esquemaEnviarNotificacion,
  esquemaProgramarNotificacion,
} from './dto/notificaciones.dto';
import { NotificacionesOutboxService } from './notificaciones-outbox.service';

/**
 * Motor de notificaciones (feature #10, R8, R9, R11).
 *
 * `@Roles('admin','empleado')` (R14). El `@Audit` de las mutaciones lleva
 * `metadata` vacío (R15: el contenido y el destinatario son dato de
 * dominio, no de auditoría).
 */
@Controller('notificaciones')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(AuditInterceptor)
@Roles('admin', 'empleado')
export class NotificacionesController {
  constructor(private readonly outbox: NotificacionesOutboxService) {}

  /** R8 — envío manual a través del outbox. */
  @Post()
  @Audit('crear', 'notificacion_pendiente')
  async enviar(
    @Body(new ZodValidationPipe(esquemaEnviarNotificacion)) dto: EnviarNotificacionDto,
    @Req() request: unknown,
  ): Promise<NotificacionPendiente> {
    const ctx = construirContextoPeticion(request);
    const { id } = await this.outbox.crear(
      { destinatario: dto.destinatario, canal: dto.canal ?? 'CORREO', contenido: dto.contenido },
      ctx,
    );
    return this.outbox.buscarPendiente(id, ctx);
  }

  /** R9 — entregas y pendientes del tenant. */
  @Get()
  async listar(@Req() request: unknown): Promise<{
    enviadas: NotificacionEnviada[];
    pendientes: NotificacionPendiente[];
  }> {
    return this.outbox.listar(construirContextoPeticion(request));
  }

  /** R11 — programar un recordatorio. */
  @Post('programadas')
  @Audit('crear', 'notificacion_programada')
  async programar(
    @Body(new ZodValidationPipe(esquemaProgramarNotificacion)) dto: ProgramarNotificacionDto,
    @Req() request: unknown,
  ): Promise<NotificacionProgramada> {
    return this.outbox.programar(
      {
        programadaPara: new Date(dto.programada_para),
        destinatario: dto.destinatario,
        canal: dto.canal,
        plantilla: dto.plantilla ?? null,
        contenido: dto.contenido,
        entidadTipo: dto.entidad_tipo ?? null,
        entidadId: dto.entidad_id ?? null,
      },
      construirContextoPeticion(request),
    );
  }

  /** R11 — listar recordatorios del tenant. */
  @Get('programadas')
  async listarProgramadas(@Req() request: unknown): Promise<NotificacionProgramada[]> {
    return this.outbox.listarProgramadas(construirContextoPeticion(request));
  }

  /** R11 — cancelar un recordatorio (baja lógica). */
  @Delete('programadas/:id')
  @Audit('baja', 'notificacion_programada')
  async cancelar(
    @Param('id') id: string,
    @Req() request: unknown,
  ): Promise<void> {
    await this.outbox.cancelarProgramada(id, construirContextoPeticion(request));
  }
}
