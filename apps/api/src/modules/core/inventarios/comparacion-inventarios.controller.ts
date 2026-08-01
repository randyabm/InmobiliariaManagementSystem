import { Controller, Get, Param, Req, UseGuards, UseInterceptors } from '@nestjs/common';

import { construirContextoPeticion } from '../../../common/database/cliente-tenant';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ComparacionInventariosService } from './comparacion-inventarios.service';

/**
 * Comparación entrada vs salida (feature #21, R1–R3, RF-I10).
 * Solo lectura: sin `@Audit` (R2).
 */
@Controller('inventarios')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(AuditInterceptor)
@Roles('admin', 'empleado')
export class ComparacionInventariosController {
  constructor(private readonly comparacion: ComparacionInventariosService) {}

  /** R1 — comparar. */
  @Get(':idEntrada/comparar/:idSalida')
  comparar(@Param('idEntrada') idEntrada: string, @Param('idSalida') idSalida: string, @Req() request: unknown) {
    return this.comparacion.comparar(construirContextoPeticion(request), idEntrada, idSalida);
  }
}
