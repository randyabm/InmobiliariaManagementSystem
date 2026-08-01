import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { construirContextoPeticion } from '../../../common/database/cliente-tenant';
import { Audit } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { RevisionInventarioService } from './revision-inventario.service';

interface CuerpoRevision {
  respuesta?: unknown;
  comentario?: unknown;
}

/**
 * Revisión del inquilino (feature #13, R6, R9) — primeras rutas de CLIENTE.
 *
 * `@Roles('inquilino')` + scoping por perfil en el servicio (R9): un
 * inquilino nunca ve ni revisa el inventario de otro.
 */
@Controller('inquilino/inventarios')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(AuditInterceptor)
@Roles('inquilino')
export class RevisionInventarioController {
  constructor(private readonly revision: RevisionInventarioService) {}

  /** R9 — leer su inventario. */
  @Get(':id')
  async obtener(@Param('id') id: string, @Req() request: unknown) {
    return this.revision.obtener(construirContextoPeticion(request), id);
  }

  /** R6 — revisar un ítem (aceptar/objetar con comentario y foto opcional). */
  @Post(':id/items/:idItem/revision')
  @UseInterceptors(FileInterceptor('archivo', { limits: { fileSize: 10 * 1024 * 1024 } }))
  @Audit('crear', 'inventario_item_revision')
  async revisar(
    @Param('id') id: string,
    @Param('idItem') idItem: string,
    @Body() cuerpo: CuerpoRevision,
    @UploadedFile() archivo: { buffer: Buffer; mimetype: string } | undefined,
    @Req() request: unknown,
  ) {
    const respuesta = cuerpo.respuesta;
    if (respuesta !== 'ACEPTADO' && respuesta !== 'OBJETADO') {
      throw new BadRequestException('respuesta debe ser ACEPTADO u OBJETADO.');
    }
    const comentario =
      typeof cuerpo.comentario === 'string' && cuerpo.comentario.trim() !== ''
        ? cuerpo.comentario
        : undefined;

    return this.revision.revisar(
      construirContextoPeticion(request),
      id,
      idItem,
      {
        respuesta,
        comentario,
        foto:
          archivo?.buffer && archivo.buffer.length > 0
            ? { binario: archivo.buffer, mime: archivo.mimetype || 'image/jpeg' }
            : undefined,
      },
    );
  }
}
