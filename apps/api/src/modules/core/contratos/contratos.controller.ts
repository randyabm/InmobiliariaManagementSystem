import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';

import { construirContextoPeticion } from '../../../common/database/cliente-tenant';
import { Audit } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ContratosService } from './contratos.service';

interface CuerpoGenerar {
  inquilino_id?: unknown;
  fecha_inicio?: unknown;
  fecha_fin?: unknown;
}

interface CuerpoFirma {
  hash_documento?: unknown;
}

interface PeticionConIp {
  ip?: string;
}

/**
 * Contratos (feature #17, R1–R6). Generación y firma del empleado:
 * admin/empleado; firma del inquilino: rol `inquilino` + scoping + OTP.
 */
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(AuditInterceptor)
@Roles('admin', 'empleado')
export class ContratosController {
  constructor(private readonly contratos: ContratosService) {}

  /** R1, R2 — generar el contrato por merge. */
  @Post('propiedades/:id/contratos')
  @Audit('crear', 'contract')
  generar(@Param('id') propertyId: string, @Body() cuerpo: CuerpoGenerar, @Req() request: unknown) {
    const inquilinoId =
      typeof cuerpo.inquilino_id === 'string' ? cuerpo.inquilino_id : '';
    const fechaInicio = typeof cuerpo.fecha_inicio === 'string' ? cuerpo.fecha_inicio : '';
    const fechaFin = typeof cuerpo.fecha_fin === 'string' ? cuerpo.fecha_fin : '';
    if (!inquilinoId || !fechaInicio || !fechaFin) {
      throw new BadRequestException('inquilino_id, fecha_inicio y fecha_fin son obligatorios.');
    }
    return this.contratos.generar(
      construirContextoPeticion(request),
      propertyId,
      { inquilino_id: inquilinoId, fecha_inicio: fechaInicio, fecha_fin: fechaFin },
    );
  }

  /** R4 — listado (filtro por propiedad). */
  @Get('contratos')
  listar(@Query('propiedadId') propertyId: string | undefined, @Req() request: unknown) {
    return this.contratos.listar(construirContextoPeticion(request), propertyId);
  }

  /** R4 — historial por propiedad. */
  @Get('propiedades/:id/contratos')
  historial(@Param('id') propertyId: string, @Req() request: unknown) {
    return this.contratos.listar(construirContextoPeticion(request), propertyId);
  }

  /** R4 — detalle. */
  @Get('contratos/:id')
  obtener(@Param('id') id: string, @Req() request: unknown) {
    return this.contratos.obtener(construirContextoPeticion(request), id);
  }

  /** R3 — firma del empleado. */
  @Post('contratos/:id/firmas/empleado')
  @Audit('firmar', 'contrato_firma')
  firmarEmpleado(
    @Param('id') id: string,
    @Body() cuerpo: CuerpoFirma,
    @Req() request: PeticionConIp,
  ) {
    return this.contratos.firmarEmpleado(
      construirContextoPeticion(request),
      id,
      validarHash(cuerpo.hash_documento),
      ipDe(request),
    );
  }

  /** R3, R5 — firma del inquilino (rol inquilino). */
  @Post('contratos/:id/firmas/inquilino')
  @Roles('inquilino')
  @Audit('firmar', 'contrato_firma')
  firmarInquilino(
    @Param('id') id: string,
    @Body() cuerpo: CuerpoFirma,
    @Req() request: PeticionConIp,
  ) {
    return this.contratos.firmarInquilino(
      construirContextoPeticion(request),
      id,
      validarHash(cuerpo.hash_documento),
      ipDe(request),
    );
  }

  /** R6 — descargar el PDF con hash verificado. */
  @Get('contratos/:id/pdf')
  async descargar(
    @Param('id') id: string,
    @Req() request: unknown,
    @Res() respuesta: Response,
  ) {
    const documento = await this.contratos.obtenerPdfFirmado(
      construirContextoPeticion(request),
      id,
    );
    respuesta.setHeader('Content-Type', 'application/pdf');
    respuesta.setHeader('Content-Disposition', `attachment; filename="contrato-${id}.pdf"`);
    respuesta.setHeader('X-Hash-SHA256', documento.hash_sha256);
    respuesta.send(documento.binario);
  }
}

function validarHash(valor: unknown): string {
  if (typeof valor !== 'string' || !/^[0-9a-f]{64}$/.test(valor)) {
    throw new BadRequestException('hash_documento inválido.');
  }
  return valor;
}

function ipDe(request: PeticionConIp): string {
  const ip = typeof request.ip === 'string' ? request.ip : '';
  return ip.length > 0 ? ip.slice(0, 64) : 'desconocida';
}
