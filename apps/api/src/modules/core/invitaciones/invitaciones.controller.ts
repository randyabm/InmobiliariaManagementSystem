import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';

import { construirContextoPeticion } from '../../../common/database/cliente-tenant';
import { Audit } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { InvitacionesService } from './invitaciones.service';

interface CuerpoInvitacion {
  perfil_inquilino_id?: unknown;
}

/**
 * Invitación de revisión (feature #13, R1, R3).
 *
 * La generación es `admin`/`empleado` (R9) y audita (R11). El bootstrap es
 * público por necesidad (sin sesión, R3) y NO expone datos sensibles: solo
 * nombres y estado del inventario.
 */
@Controller()
@UseInterceptors(AuditInterceptor)
export class InvitacionesController {
  constructor(private readonly invitaciones: InvitacionesService) {}

  /** R1, R2 — generar la invitación. */
  @Post('inventarios/:id/invitaciones')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'empleado')
  @Audit('crear', 'invitacion_inventario')
  async generar(
    @Param('id') id: string,
    @Body() cuerpo: CuerpoInvitacion,
    @Req() request: unknown,
  ) {
    const perfilInquilinoId =
      typeof cuerpo.perfil_inquilino_id === 'string' &&
      /^[0-9a-fA-F-]{36}$/.test(cuerpo.perfil_inquilino_id)
        ? cuerpo.perfil_inquilino_id
        : null;
    if (perfilInquilinoId === null) {
      throw new BadRequestException('perfil_inquilino_id inválido.');
    }
    return this.invitaciones.generar(
      construirContextoPeticion(request),
      { inventarioId: id, perfilInquilinoId },
    );
  }

  /** R3 — bootstrap público sin sesión (mínimo de datos). */
  @Get('invitaciones/:token')
  async bootstrap(@Param('token') token: string) {
    return this.invitaciones.bootstrap(token);
  }
}
