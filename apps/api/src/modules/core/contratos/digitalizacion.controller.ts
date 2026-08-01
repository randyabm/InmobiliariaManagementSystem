import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';

import { construirContextoPeticion } from '../../../common/database/cliente-tenant';
import { Audit } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { DigitalizacionService } from './digitalizacion.service';

interface PeticionConForm {
  body?: Record<string, unknown>;
}

/**
 * Digitalización de contratos físicos (feature #18, R1–R3). Multipart:
 * `archivo` (PDF) + `nombre` + metadatos por form.
 */
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(AuditInterceptor)
@Roles('admin', 'empleado')
export class DigitalizacionController {
  constructor(private readonly digitalizacion: DigitalizacionService) {}

  /** R1 — subir el escaneo con metadatos. */
  @Post('contratos/digitalizados')
  @UseInterceptors(FileInterceptor('archivo', { limits: { fileSize: 20 * 1024 * 1024 } }))
  @Audit('crear', 'contract_document')
  async subir(
    @UploadedFile() archivo: { buffer: Buffer; mimetype: string } | undefined,
    @Req() request: PeticionConForm,
  ) {
    if (!archivo?.buffer) {
      throw new BadRequestException('Se requiere un archivo.');
    }
    const form = request.body ?? {};
    const str = (v: unknown): string | undefined =>
      typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
    const propiedadId = str(form.propiedad_id);
    if (!propiedadId) {
      throw new BadRequestException('propiedad_id es obligatorio.');
    }
    return this.digitalizacion.subirDigitalizado(construirContextoPeticion(request), {
      nombre: str(form.nombre) ?? 'contrato digitalizado',
      binario: archivo.buffer,
      mime: archivo.mimetype || 'application/pdf',
      propiedad_id: propiedadId,
      inquilino_id: str(form.inquilino_id),
      fecha_inicio: str(form.fecha_inicio),
      fecha_fin: str(form.fecha_fin),
      canon: str(form.canon),
      contract_id: str(form.contract_id),
    });
  }

  /** R2 — documentos del contrato. */
  @Get('contratos/:id/documentos')
  listarDeContrato(@Param('id') id: string, @Req() request: unknown) {
    return this.digitalizacion.listarDeContrato(construirContextoPeticion(request), id);
  }

  /** R2 — documentos de los contratos de la propiedad. */
  @Get('propiedades/:id/contratos/documentos')
  listarDePropiedad(@Param('id') id: string, @Req() request: unknown) {
    return this.digitalizacion.listarDePropiedad(construirContextoPeticion(request), id);
  }

  /** R3 — descarga con hash verificado. */
  @Get('contratos/:id/documentos/:idDocumento/pdf')
  async descargar(
    @Param('id') id: string,
    @Param('idDocumento') idDocumento: string,
    @Req() request: unknown,
    @Res() respuesta: Response,
  ) {
    const documento = await this.digitalizacion.descargar(
      construirContextoPeticion(request),
      id,
      idDocumento,
    );
    respuesta.setHeader('Content-Type', 'application/pdf');
    respuesta.setHeader('Content-Disposition', `attachment; filename="${documento.nombre}"`);
    respuesta.setHeader('X-Hash-SHA256', documento.hash_sha256);
    respuesta.send(documento.binario);
  }
}
