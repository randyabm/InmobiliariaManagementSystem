import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';

import { construirContextoPeticion } from '../../../common/database/cliente-tenant';
import { Audit } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { TicketsService } from './tickets.service';

interface CuerpoCrear {
  categoria?: unknown;
  descripcion?: unknown;
}

interface CuerpoComentario {
  comentario?: unknown;
}

interface CuerpoResolucion {
  aceptada?: unknown;
}

interface CuerpoCostos {
  aprobado?: unknown;
}

/**
 * Tickets de mantenimiento (feature #31, R1–R6, §6.5).
 * El scoping por rol se resuelve en el servicio (RF-M7).
 */
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(AuditInterceptor)
@Roles('admin', 'empleado', 'inquilino', 'propietario')
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  /** R1 — crear una solicitud. */
  @Post('propiedades/:id/tickets')
  @Audit('crear', 'ticket')
  crear(@Param('id') propertyId: string, @Body() cuerpo: CuerpoCrear, @Req() request: unknown) {
    const categoria =
      typeof cuerpo.categoria === 'string' && cuerpo.categoria.trim() !== ''
        ? cuerpo.categoria.trim().slice(0, 200)
        : '';
    const descripcion =
      typeof cuerpo.descripcion === 'string' && cuerpo.descripcion.trim() !== ''
        ? cuerpo.descripcion.trim().slice(0, 4000)
        : '';
    if (!categoria || !descripcion) {
      throw new BadRequestException('categoria y descripcion son obligatorios.');
    }
    return this.tickets.crear(construirContextoPeticion(request), propertyId, {
      categoria,
      descripcion,
    });
  }

  /** R2 — listar con scoping. */
  @Get('tickets')
  listar(@Req() request: unknown) {
    return this.tickets.listar(construirContextoPeticion(request));
  }

  /** R2 — detalle. */
  @Get('tickets/:id')
  obtener(@Param('id') id: string, @Req() request: unknown) {
    return this.tickets.obtener(construirContextoPeticion(request), id);
  }

  /** R4 — comentario (solicitante). */
  @Post('tickets/:id/comentarios')
  @Audit('comentar', 'ticket')
  comentar(@Param('id') id: string, @Body() cuerpo: CuerpoComentario, @Req() request: unknown) {
    const comentario =
      typeof cuerpo.comentario === 'string' && cuerpo.comentario.trim() !== ''
        ? cuerpo.comentario.trim().slice(0, 4000)
        : '';
    if (!comentario) throw new BadRequestException('comentario es obligatorio.');
    return this.tickets.agregarComentario(construirContextoPeticion(request), id, comentario);
  }

  /** R4 — aceptar/rechazar la resolución. */
  @Post('tickets/:id/resolucion')
  @Audit('resolver', 'ticket')
  resolver(@Param('id') id: string, @Body() cuerpo: CuerpoResolucion, @Req() request: unknown) {
    return this.tickets.resolver(construirContextoPeticion(request), id, cuerpo.aceptada === true);
  }

  /** R5 — aprobar costos (propietario). */
  @Post('tickets/:id/costos/aprobar')
  @Roles('propietario')
  @Audit('aprobar_costos', 'ticket')
  aprobarCostos(@Param('id') id: string, @Body() cuerpo: CuerpoCostos, @Req() request: unknown) {
    return this.tickets.aprobarCostos(construirContextoPeticion(request), id, cuerpo.aprobado === true);
  }

  /** R5 — transiciones de gestión por clave. */
  @Post('tickets/:id/transiciones/:clave')
  @Roles('admin', 'empleado')
  @Audit('transicionar', 'ticket')
  transicionar(@Param('id') id: string, @Param('clave') clave: string, @Req() request: unknown) {
    return this.tickets.transicionar(construirContextoPeticion(request), id, clave);
  }
}
