import { Controller, Get, Param, Post, Req, UseGuards, UseInterceptors } from '@nestjs/common';

import { construirContextoPeticion } from '../../../common/database/cliente-tenant';
import { Audit } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { VersionadoInventariosService } from './versionado-inventarios.service';

/**
 * Versionado de la negociación (feature #22, R1–R4, RF-I6).
 */
@Controller('inventarios/:id')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(AuditInterceptor)
@Roles('admin', 'empleado')
export class VersionadoInventariosController {
  constructor(private readonly versionado: VersionadoInventariosService) {}

  /** R1, R2 — abrir/avanzar la negociación (nueva versión). */
  @Post('negociar')
  @Audit('negociar', 'inventario_version')
  negociar(@Param('id') id: string, @Req() request: unknown) {
    return this.versionado.negociar(construirContextoPeticion(request), id);
  }

  /** R4 — historial de versiones. */
  @Get('versiones')
  listar(@Param('id') id: string, @Req() request: unknown) {
    return this.versionado.listarVersiones(construirContextoPeticion(request), id);
  }
}
