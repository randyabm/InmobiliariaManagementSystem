import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';

import { construirContextoPeticion } from '../../../../common/database/cliente-tenant';
import { Audit } from '../../audit/audit.decorator';
import { AuditInterceptor } from '../../audit/audit.interceptor';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { FirmaPdfService } from './firma-pdf.service';

interface CuerpoFirma {
  hash_documento?: unknown;
}

interface PeticionConIp {
  ip?: string;
}

/**
 * Firma electrónica y PDF del inventario (feature #14, R1–R7).
 *
 * La generación y la firma del empleado son `admin`/`empleado`; la firma
 * del inquilino exige el rol `inquilino` + scoping por perfil (#13, R9) +
 * OTP de FIRMA reciente (R4). La IP de la petición vive en la evidencia
 * (R3), nunca en `audit_log.metadata` (R10).
 */
@Controller('inventarios/:id')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(AuditInterceptor)
export class FirmaPdfController {
  constructor(private readonly firma: FirmaPdfService) {}

  /** R6 — confirmar el acuerdo (exige revisión completa). */
  @Post('confirmar-acuerdo')
  @Roles('admin', 'empleado')
  @Audit('confirmar', 'inventario')
  async confirmarAcuerdo(@Param('id') id: string, @Req() request: unknown) {
    await this.firma.confirmarAcuerdo(construirContextoPeticion(request), id);
  }

  /** R1 — generar el PDF consolidado (se materializa con su hash). */
  @Post('pdf')
  @Roles('admin', 'empleado')
  @Audit('crear', 'propiedad_documento')
  async generarPdf(@Param('id') id: string, @Req() request: unknown) {
    const generado = await this.firma.generarPdf(construirContextoPeticion(request), id);
    return {
      hash_sha256: generado.hash_sha256,
      tamano_bytes: generado.tamano_bytes,
    };
  }

  /** R3, R5 — firma del empleado. */
  @Post('firmas/empleado')
  @Roles('admin', 'empleado')
  @Audit('firmar', 'inventario_firma')
  async firmarEmpleado(
    @Param('id') id: string,
    @Body() cuerpo: CuerpoFirma,
    @Req() request: PeticionConIp,
  ) {
    const hash = validarHash(cuerpo.hash_documento);
    return this.firma.firmarEmpleado(
      construirContextoPeticion(request),
      id,
      hash,
      ipDe(request),
    );
  }

  /** R4, R5 — firma del inquilino (scoping + OTP de FIRMA reciente). */
  @Post('firmas/inquilino')
  @Roles('inquilino')
  @Audit('firmar', 'inventario_firma')
  async firmarInquilino(
    @Param('id') id: string,
    @Body() cuerpo: CuerpoFirma,
    @Req() request: PeticionConIp,
  ) {
    const hash = validarHash(cuerpo.hash_documento);
    return this.firma.firmarInquilino(
      construirContextoPeticion(request),
      id,
      hash,
      ipDe(request),
    );
  }

  /** R7, R11 — descargar el documento firmado (hash verificado). */
  @Get('pdf')
  @Roles('admin', 'empleado')
  async descargarPdf(
    @Param('id') id: string,
    @Req() request: unknown,
    @Res() respuesta: Response,
    @Headers('x-forwarded-for') _xForwardedFor: string | undefined,
  ) {
    const documento = await this.firma.obtenerPdfFirmado(
      construirContextoPeticion(request),
      id,
    );
    respuesta.setHeader('Content-Type', 'application/pdf');
    respuesta.setHeader(
      'Content-Disposition',
      `attachment; filename="inventario-${id}.pdf"`,
    );
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
