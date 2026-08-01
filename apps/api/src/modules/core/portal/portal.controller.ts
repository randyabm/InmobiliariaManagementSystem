import { Body, Controller, Get, Post, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';

import { construirContextoPeticion } from '../../../common/database/cliente-tenant';
import { Audit } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PortalService } from './portal.service';

/**
 * Portales embebibles (feature #32, R2–R5).
 */
@Controller('portal')
@UseGuards(JwtAuthGuard)
@UseInterceptors(AuditInterceptor)
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  /** R2, R5 — canjear el handshake SSO (token de un solo uso). */
  @Post('sso')
  @Audit('sso', 'tenant_dominio')
  canjear(@Body() cuerpo: { token?: unknown }, @Req() request: unknown) {
    const token = typeof cuerpo.token === 'string' ? cuerpo.token : '';
    return this.portal.canjearHandshake(construirContextoPeticion(request), token);
  }

  /** R4 — configuración pública del tenant (theming, white-label). */
  @Get('config')
  config(@Query('dominio') dominio: string | undefined, @Req() request: unknown) {
    return this.portal.configPublica(construirContextoPeticion(request), dominio ?? '');
  }
}
