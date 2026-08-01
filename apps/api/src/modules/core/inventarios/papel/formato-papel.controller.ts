import {
  BadRequestException,
  Body,
  Controller,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';

import { construirContextoPeticion } from '../../../../common/database/cliente-tenant';
import { Audit } from '../../audit/audit.decorator';
import { AuditInterceptor } from '../../audit/audit.interceptor';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { FormatoPapelService } from './formato-papel.service';

interface PeticionConForm {
  body?: {
    notas?: unknown;
    perfil_inquilino_id?: unknown;
  };
  files?: Array<{ fieldname: string; originalname: string; buffer: Buffer; mimetype: string }>;
}

/**
 * Formato en papel (feature #29, R1–R3, §10.5).
 */
@Controller('inventarios/:id')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(AuditInterceptor)
@Roles('admin', 'empleado')
export class FormatoPapelController {
  constructor(private readonly formato: FormatoPapelService) {}

  /** R1 — generar el PDF imprimible (sin fotos, con ID de vínculo). */
  @Post('formato-papel')
  @Audit('crear', 'inventario')
  async generarFormato(@Param('id') id: string, @Req() request: unknown, @Res() respuesta: Response) {
    const generado = await this.formato.generarFormatoPapel(construirContextoPeticion(request), id);
    respuesta.setHeader('Content-Type', 'application/pdf');
    respuesta.setHeader('Content-Disposition', `attachment; filename="formato-inventario-${id.slice(0, 8)}.pdf"`);
    respuesta.setHeader('X-Vinculo-Inventario', generado.vinculo);
    respuesta.send(generado.binario);
  }

  /**
   * R2 — reconstrucción digital (multipart): `notas` (JSON con
   * item_id/nota_agente/nota_inquilino), fotos (field `fotos` con
   * originalname `item_id.ext`) y `escaneo_papel` (PDF).
   */
  @Post('reconstruir')
  @UseInterceptors(AnyFilesInterceptor({ limits: { fileSize: 20 * 1024 * 1024 } }))
  @Audit('actualizar', 'inventario')
  async reconstruir(@Param('id') id: string, @Req() request: PeticionConForm) {
    return this.reconstruirInterno(id, request);
  }

  private async reconstruirInterno(
    id: string,
    request: PeticionConForm,
  ) {
    const notas = validarNotas(request.body?.notas);
    const fotos = (request.files ?? [])
      .filter((f) => f.fieldname === 'fotos')
      .map((f) => {
        const itemId = f.originalname.split('.')[0];
        if (!itemId) throw new BadRequestException('El nombre de cada foto debe ser el item_id.');
        return { item_id: itemId, binario: f.buffer, mime: f.mimetype || 'image/jpeg' };
      });
    const escaneo = (request.files ?? []).find((f) => f.fieldname === 'escaneo_papel');
    return this.formato.reconstruir(construirContextoPeticion(request), id, {
      notas,
      fotos,
      escaneo: escaneo?.buffer
        ? { binario: escaneo.buffer, mime: escaneo.mimetype || 'application/pdf' }
        : undefined,
    });
  }

  /** R3 — confirmar el papel: BORRADOR → ENVIADO con el perfil. */
  @Post('confirmar-papel')
  @Audit('enviar', 'inventario')
  async confirmarPapel(
    @Param('id') id: string,
    @Body() cuerpo: { perfil_inquilino_id?: unknown },
    @Req() request: unknown,
  ) {
    const perfil = typeof cuerpo.perfil_inquilino_id === 'string' ? cuerpo.perfil_inquilino_id : '';
    if (!perfil) {
      throw new BadRequestException('perfil_inquilino_id es obligatorio.');
    }
    await this.formato.confirmarPapel(construirContextoPeticion(request), id, perfil);
  }
}

function validarNotas(valor: unknown): Array<{
  item_id: string;
  nota_agente?: string;
  nota_inquilino?: string;
}> {
  // En multipart el campo llega como string JSON.
  if (typeof valor === 'string') {
    try {
      valor = JSON.parse(valor);
    } catch {
      throw new BadRequestException('notas debe ser una lista JSON válida.');
    }
  }
  if (!Array.isArray(valor)) {
    throw new BadRequestException('notas debe ser una lista.');
  }
  return valor.map((fila) => {
    if (typeof fila !== 'object' || fila === null) {
      throw new BadRequestException('Cada nota debe ser un objeto.');
    }
    const f = fila as { item_id?: unknown; nota_agente?: unknown; nota_inquilino?: unknown };
    if (typeof f.item_id !== 'string') {
      throw new BadRequestException('Cada nota requiere item_id.');
    }
    return {
      item_id: f.item_id,
      nota_agente: typeof f.nota_agente === 'string' ? f.nota_agente : undefined,
      nota_inquilino: typeof f.nota_inquilino === 'string' ? f.nota_inquilino : undefined,
    };
  });
}
