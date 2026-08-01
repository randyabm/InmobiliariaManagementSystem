import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { EstadoInventario, TipoEventoInventario } from '@inmobiliaria/types';

import { construirContextoPeticion } from '../../../common/database/cliente-tenant';
import { Audit } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { InventariosService } from './inventarios.service';

interface CuerpoCrear {
  propiedad_id?: unknown;
  tipo_evento?: unknown;
}

interface CuerpoRespuestaItem {
  estado_checklist?: unknown;
  valor_respuesta?: unknown;
  comentario?: unknown;
}

interface CuerpoZona {
  nombre?: unknown;
  orden?: unknown;
  repetible?: unknown;
}

/**
 * Inventario (feature #12, §8.7) — superficie HTTP del borrador.
 *
 * `@Roles('admin','empleado')` (R8). La respuesta de los ítems admite
 * `estado_checklist` (BUENO/REGULAR/MALO), `valor_respuesta` (jsonb) y
 * `comentario`; el CHECK de la base valida los enums, el servicio valida
 * el dominio (R7, R8).
 */
@Controller('inventarios')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(AuditInterceptor)
@Roles('admin', 'empleado')
export class InventariosController {
  constructor(private readonly inventarios: InventariosService) {}

  /** R1, R4 — alta materializando la plantilla vigente. */
  @Post()
  @Audit('crear', 'inventario')
  async crear(@Body() cuerpo: CuerpoCrear, @Req() request: unknown) {
    const propiedadId = validarPropiedadId(cuerpo.propiedad_id);
    const tipoEvento = validarTipoEvento(cuerpo.tipo_evento);
    return this.inventarios.crear(
      { propiedadId, tipoEvento },
      construirContextoPeticion(request),
    );
  }

  /** R1 — listado con filtros opcionales. */
  @Get()
  async listar(@Req() request: { query?: Record<string, unknown> }) {
    const query = request.query ?? {};
    const filtros: {
      propiedadId?: string;
      estado?: EstadoInventario;
      tipoEvento?: TipoEventoInventario;
    } = {};
    if (typeof query.propiedadId === 'string') filtros.propiedadId = query.propiedadId;
    if (typeof query.estado === 'string') filtros.estado = query.estado as EstadoInventario;
    if (typeof query.tipoEvento === 'string') {
      filtros.tipoEvento = query.tipoEvento as TipoEventoInventario;
    }
    return this.inventarios.listar(
      construirContextoPeticion(request),
      filtros,
    );
  }

  /** R1 — lectura completa. */
  @Get(':id')
  async obtener(@Param('id') id: string, @Req() request: unknown) {
    return this.inventarios.obtener(construirContextoPeticion(request), id);
  }

  /** R6 — reordenar zonas (lista completa en el nuevo orden). */
  @Patch(':id/zonas/orden')
  @Audit('actualizar', 'inventario')
  async reordenarZonas(
    @Param('id') id: string,
    @Body() cuerpo: { zonas?: unknown },
    @Req() request: unknown,
  ) {
    if (!Array.isArray(cuerpo.zonas) || cuerpo.zonas.length === 0) {
      throw new BadRequestException('Se requiere la lista de zonas en el nuevo orden.');
    }
    if (!cuerpo.zonas.every((z) => typeof z === 'string')) {
      throw new BadRequestException('La lista de zonas debe contener solo ids.');
    }
    await this.inventarios.reordenarZonas(
      construirContextoPeticion(request),
      id,
      cuerpo.zonas as string[],
    );
  }

  /** R7 — editar una zona del borrador. */
  @Patch(':id/zonas/:zonaId')
  @Audit('actualizar', 'inventario')
  async actualizarZona(
    @Param('id') id: string,
    @Param('zonaId') zonaId: string,
    @Body() cuerpo: CuerpoZona,
    @Req() request: unknown,
  ) {
    const cambios: { nombre?: string; orden?: number; repetible?: boolean } = {};
    if (typeof cuerpo.nombre === 'string' && cuerpo.nombre.trim() !== '') {
      cambios.nombre = cuerpo.nombre.trim().slice(0, 200);
    }
    if (typeof cuerpo.orden === 'number' && Number.isInteger(cuerpo.orden)) {
      cambios.orden = cuerpo.orden;
    }
    if (typeof cuerpo.repetible === 'boolean') {
      cambios.repetible = cuerpo.repetible;
    }
    if (Object.keys(cambios).length === 0) {
      throw new BadRequestException('No hay cambios válidos.');
    }
    await this.inventarios.actualizarZona(
      construirContextoPeticion(request),
      id,
      zonaId,
      cambios,
    );
  }

  /** R8 — registrar la respuesta de un ítem. */
  @Patch(':id/items/:itemId')  @Audit('actualizar', 'inventario')
  async responderItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() cuerpo: CuerpoRespuestaItem,
    @Req() request: unknown,
  ) {
    const cambios: {
      estadoChecklist?: 'BUENO' | 'REGULAR' | 'MALO';
      valorRespuesta?: Record<string, unknown>;
      comentario?: string;
    } = {};
    const estados = ['BUENO', 'REGULAR', 'MALO'];
    if (cuerpo.estado_checklist !== undefined) {
      if (
        typeof cuerpo.estado_checklist !== 'string' ||
        !estados.includes(cuerpo.estado_checklist)
      ) {
        throw new BadRequestException('estado_checklist inválido.');
      }
      cambios.estadoChecklist = cuerpo.estado_checklist as 'BUENO' | 'REGULAR' | 'MALO';
    }
    if (cuerpo.valor_respuesta !== undefined) {
      if (typeof cuerpo.valor_respuesta !== 'object' || cuerpo.valor_respuesta === null) {
        throw new BadRequestException('valor_respuesta debe ser un objeto.');
      }
      cambios.valorRespuesta = cuerpo.valor_respuesta as Record<string, unknown>;
    }
    if (typeof cuerpo.comentario === 'string' && cuerpo.comentario.trim() !== '') {
      cambios.comentario = cuerpo.comentario.trim().slice(0, 2000);
    }
    if (Object.keys(cambios).length === 0) {
      throw new BadRequestException('No hay cambios válidos.');
    }
    await this.inventarios.responderItem(
      construirContextoPeticion(request),
      id,
      itemId,
      cambios,
    );
  }

  /** R3 — foto de un ítem (multipart, máx. 10 MB como #6). */
  @Post(':id/items/:itemId/fotos')
  @UseInterceptors(FileInterceptor('archivo', { limits: { fileSize: 10 * 1024 * 1024 } }))
  @Audit('crear', 'inventario_item_foto')
  async subirFoto(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @UploadedFile() archivo: { buffer: Buffer; mimetype: string } | undefined,
    @Req() request: unknown,
  ) {
    if (!archivo || !archivo.buffer) {
      throw new BadRequestException('Se requiere un archivo.');
    }
    return this.inventarios.subirFoto(
      construirContextoPeticion(request),
      id,
      itemId,
      archivo.buffer,
      archivo.mimetype || 'image/jpeg',
    );
  }

  /** R10 — baja lógica de la foto; el objeto en MinIO se conserva. */
  @Delete(':id/fotos/:idFoto')
  @Audit('baja', 'inventario_item_foto')
  async eliminarFoto(
    @Param('id') id: string,
    @Param('idFoto') fotoId: string,
    @Req() request: unknown,
  ) {
    await this.inventarios.eliminarFoto(construirContextoPeticion(request), id, fotoId);
  }

  /** R5 — eliminar el borrador. */
  @Delete(':id')
  @Audit('baja', 'inventario')
  async eliminar(@Param('id') id: string, @Req() request: unknown) {
    await this.inventarios.eliminar(construirContextoPeticion(request), id);
  }
}

function validarPropiedadId(valor: unknown): string {
  if (typeof valor !== 'string' || !/^[0-9a-fA-F-]{36}$/.test(valor)) {
    throw new BadRequestException('propiedad_id inválido.');
  }
  return valor;
}

function validarTipoEvento(valor: unknown): TipoEventoInventario {
  if (valor !== 'ENTREGA' && valor !== 'DEVOLUCION') {
    throw new BadRequestException('tipo_evento debe ser ENTREGA o DEVOLUCION.');
  }
  return valor;
}
