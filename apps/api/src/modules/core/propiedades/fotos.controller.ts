import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Param,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Propiedad } from '@inmobiliaria/types';

import { construirContextoPeticion } from '../../../common/database/cliente-tenant';
import { ZodValidationPipe } from '../../../common/validation/zod-validation.pipe';
import { Audit } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { esquemaQuitarFoto } from './dto/acciones-propiedad.dto';
import { FotosService } from './fotos.service';

/**
 * Fotos de la propiedad (RF-P1, R17).
 *
 * `@Roles('admin','empleado')` (R18). Ambos endpoints devuelven la ficha
 * actualizada (con su `id`) para que el `@Audit` registre la propiedad.
 */
@Controller('propiedades/:id/fotos')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(AuditInterceptor)
@Roles('admin', 'empleado')
export class FotosController {
  constructor(private readonly fotos: FotosService) {}

  /** R17 — subir una foto (multipart, campo `archivo`). */
  @Post()
  @UseInterceptors(FileInterceptor('archivo', { limits: { fileSize: 10 * 1024 * 1024 } }))
  @Audit('actualizar', 'propiedad')
  async subir(
    @Param('id') propiedadId: string,
    @UploadedFile() archivo: { buffer: Buffer; mimetype: string } | undefined,
    @Req() request: unknown,
  ): Promise<Propiedad> {
    if (!archivo || !archivo.buffer) {
      throw new BadRequestException('Se requiere un archivo.');
    }
    return this.fotos.subir(
      propiedadId,
      archivo.buffer,
      archivo.mimetype || 'image/jpeg',
      construirContextoPeticion(request),
    );
  }

  /** R17 — quitar una clave del array; clave ajena → 400. */
  @Delete()
  @Audit('actualizar', 'propiedad')
  async quitar(
    @Param('id') propiedadId: string,
    @Body(new ZodValidationPipe(esquemaQuitarFoto)) dto: { clave: string },
    @Req() request: unknown,
  ): Promise<Propiedad> {
    return this.fotos.quitar(
      propiedadId,
      dto.clave,
      construirContextoPeticion(request),
    );
  }
}
