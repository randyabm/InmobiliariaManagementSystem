import { BadRequestException, Body, Controller, Post, Req, UseGuards, UseInterceptors } from '@nestjs/common';

import { construirContextoPeticion } from '../../../common/database/cliente-tenant';
import { Audit } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AsistenteService } from './asistente.service';

/**
 * Asistente conversacional (feature #33, R1–R7, §14, D8).
 * Cada consulta corre con la identidad del usuario (RF-CB10) y queda
 * auditada (RF-CB12).
 */
@Controller('asistente')
@UseGuards(JwtAuthGuard)
@UseInterceptors(AuditInterceptor)
export class AsistenteController {
  constructor(private readonly asistente: AsistenteService) {}

  /** R1–R4 — conversar con herramientas acotadas. */
  @Post('conversar')
  @Audit('consultar', 'asistente')
  conversar(@Body() cuerpo: { mensaje?: unknown }, @Req() request: unknown) {
    const mensaje = typeof cuerpo.mensaje === 'string' ? cuerpo.mensaje.trim() : '';
    if (!mensaje) {
      throw new BadRequestException('mensaje es obligatorio.');
    }
    return this.asistente.responder(construirContextoPeticion(request), mensaje);
  }
}
