import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { PropiedadDocumento } from '@inmobiliaria/types';

import { construirContextoPeticion } from '../../../common/database/cliente-tenant';
import { Audit } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { DocumentosService } from './documentos.service';

interface PeticionConForm {
  body?: { nombre?: unknown; tipo_documento?: unknown };
}

/**
 * Repositorio documental de la propiedad (RF-P3, R13, R16).
 *
 * `@Roles('admin','empleado')` (R18). Multipart con `FileInterceptor`:
 * `nombre` (form) y opcional `tipo_documento` (form); el `entity_id` de la
 * auditoría es el id del documento.
 *
 * ## Límites (R15)
 *
 * El binario vive en memoria solo durante la subida (límite de multer:
 * 10 MB) y jamás llega a logs ni a la base: la fila guarda clave, hash, mime
 * y tamaño.
 */
@Controller('propiedades/:idPropiedad/documentos')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(AuditInterceptor)
@Roles('admin', 'empleado')
export class DocumentosController {
  constructor(private readonly documentos: DocumentosService) {}

  /** R13, R21. */
  @Post()
  @UseInterceptors(FileInterceptor('archivo', { limits: { fileSize: 10 * 1024 * 1024 } }))
  @Audit('crear', 'propiedad_documento')
  async subir(
    @Param('idPropiedad') propiedadId: string,
    @UploadedFile() archivo: { buffer: Buffer; mimetype: string } | undefined,
    @Req() request: PeticionConForm,
  ): Promise<PropiedadDocumento> {
    if (!archivo || !archivo.buffer) {
      throw new BadRequestException('Se requiere un archivo.');
    }

    const cuerpo = request.body ?? {};
    const nombre = typeof cuerpo.nombre === 'string' && cuerpo.nombre.trim() !== ''
      ? cuerpo.nombre.trim().slice(0, 200)
      : 'documento';

    return this.documentos.subir(
      propiedadId,
      {
        nombre,
        tipoDocumento:
          typeof cuerpo.tipo_documento === 'string' && cuerpo.tipo_documento.trim() !== ''
            ? cuerpo.tipo_documento.trim().slice(0, 120)
            : null,
        binario: archivo.buffer,
        mime: archivo.mimetype || 'application/octet-stream',
      },
      construirContextoPeticion(request),
    );
  }

  /** R16. */
  @Get()
  async listar(
    @Param('idPropiedad') propiedadId: string,
    @Req() request: unknown,
  ): Promise<PropiedadDocumento[]> {
    return this.documentos.listar(
      propiedadId,
      construirContextoPeticion(request),
    );
  }

  /** R16 — baja lógica; el objeto NO se borra. */
  @Delete(':idDocumento')
  @Audit('baja', 'propiedad_documento')
  async archivar(
    @Param('idPropiedad') propiedadId: string,
    @Param('idDocumento') idDocumento: string,
    @Req() request: unknown,
  ): Promise<void> {
    await this.documentos.archivar(
      propiedadId,
      idDocumento,
      construirContextoPeticion(request),
    );
  }
}
