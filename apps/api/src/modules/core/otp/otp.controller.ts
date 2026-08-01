import { BadRequestException, Body, Controller, Post, Param, Req, UseGuards, UseInterceptors } from '@nestjs/common';

import { construirContextoPeticion } from '../../../common/database/cliente-tenant';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Audit } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { OtpService } from './otp.service';
import { RegistroInvitacionService } from './registro-invitacion.service';

interface CuerpoSolicitar {
  proposito?: unknown;
}

interface CuerpoVerificar {
  codigo?: unknown;
  proposito?: unknown;
}

interface CuerpoRegistro {
  nombre?: unknown;
  tipo_documento?: unknown;
  documento?: unknown;
  password?: unknown;
  email?: unknown;
  celular?: unknown;
}

/**
 * OTP y registro desde invitación (feature #13, R4, R5, R8).
 *
 * `solicitar`/`verificar` exigen sesión (#27); el registro es público por
 * necesidad (sin sesión, R3) y valida la invitación con 401 uniforme.
 */
@Controller()
@UseInterceptors(AuditInterceptor)
export class OtpController {
  constructor(
    private readonly otp: OtpService,
    private readonly registro: RegistroInvitacionService,
  ) {}

  /** R3-R5 — crear la cuenta persistente desde la invitación. */
  @Post('invitaciones/:token/registro')
  registrar(@Param('token') token: string, @Body() cuerpo: CuerpoRegistro) {
    const nombre = typeof cuerpo.nombre === 'string' ? cuerpo.nombre.trim() : '';
    const tipoDocumento =
      typeof cuerpo.tipo_documento === 'string' ? cuerpo.tipo_documento : '';
    const documento = typeof cuerpo.documento === 'string' ? cuerpo.documento.trim() : '';
    const password = typeof cuerpo.password === 'string' ? cuerpo.password : '';
    const email = typeof cuerpo.email === 'string' ? cuerpo.email.trim() : undefined;
    const celular = typeof cuerpo.celular === 'string' ? cuerpo.celular.trim() : undefined;
    if (!nombre || !tipoDocumento || !documento || !password) {
      throw new BadRequestException('Faltan campos obligatorios.');
    }
    return this.registro.registrarDesdeInvitacion({
      token,
      nombre,
      tipo_documento: tipoDocumento,
      documento,
      password,
      email,
      celular,
    });
  }

  /** R4, R8 — solicitar un OTP (proposito REGISTRO/LOGIN/FIRMA). */
  @Post('auth/otp/solicitar')
  @UseGuards(JwtAuthGuard)
  @Audit('crear', 'codigo_otp')
  solicitar(@Body() cuerpo: CuerpoSolicitar, @Req() request: unknown) {
    const proposito = validarProposito(cuerpo.proposito);
    return this.otp.solicitar(construirContextoPeticion(request), { proposito });
  }

  /** R5 — verificar el OTP (401 uniforme). */
  @Post('auth/otp/verificar')
  @UseGuards(JwtAuthGuard)
  @Audit('verificar', 'codigo_otp')
  verificar(@Body() cuerpo: CuerpoVerificar, @Req() request: unknown) {
    const codigo = typeof cuerpo.codigo === 'string' ? cuerpo.codigo : '';
    const proposito = validarProposito(cuerpo.proposito);
    return this.otp.verificar(construirContextoPeticion(request), { codigo, proposito });
  }
}

function validarProposito(valor: unknown): 'REGISTRO' | 'LOGIN' | 'FIRMA' {
  if (valor === 'REGISTRO' || valor === 'LOGIN' || valor === 'FIRMA') return valor;
  throw new BadRequestException('proposito inválido.');
}
