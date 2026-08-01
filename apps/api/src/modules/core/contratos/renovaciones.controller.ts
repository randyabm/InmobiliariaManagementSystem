import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
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
import { RenovacionesService } from './renovaciones.service';

interface CuerpoConfig {
  umbrales_dias?: unknown;
  avisar_a?: unknown;
  ipc_anual?: unknown;
}

interface CuerpoRenovar {
  nuevo_canon?: unknown;
  nueva_fecha_fin?: unknown;
}

/**
 * Renovaciones y alertas (feature #19, R1–R5, Ley 820).
 * Configuración y alertas: solo admin; panel, renovar y no-renovar:
 * admin/empleado.
 */
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(AuditInterceptor)
@Roles('admin', 'empleado')
export class RenovacionesController {
  constructor(private readonly renovaciones: RenovacionesService) {}

  /** R1 — configuración del tenant (solo admin). */
  @Get('configuracion-renovacion')
  @Roles('admin')
  obtenerConfiguracion(@Req() request: unknown) {
    return this.renovaciones.obtenerConfiguracion(construirContextoPeticion(request));
  }

  /** R1 — guardar la configuración (solo admin). */
  @Put('configuracion-renovacion')
  @Roles('admin')
  @Audit('actualizar', 'config_renovacion')
  async guardarConfiguracion(@Body() cuerpo: CuerpoConfig, @Req() request: unknown) {
    const datos: { umbrales_dias?: number[]; avisar_a?: string[]; ipc_anual?: number } = {};
    if (Array.isArray(cuerpo.umbrales_dias)) {
      datos.umbrales_dias = cuerpo.umbrales_dias
        .filter((u): u is number => typeof u === 'number' && u > 0)
        .slice(0, 10);
    }
    if (Array.isArray(cuerpo.avisar_a)) {
      datos.avisar_a = cuerpo.avisar_a
        .filter((a): a is string => typeof a === 'string')
        .slice(0, 10);
    }
    if (typeof cuerpo.ipc_anual === 'number' && cuerpo.ipc_anual >= 0) {
      datos.ipc_anual = cuerpo.ipc_anual;
    }
    await this.renovaciones.guardarConfiguracion(construirContextoPeticion(request), datos);
    return this.renovaciones.obtenerConfiguracion(construirContextoPeticion(request));
  }

  /** R2 — panel de vencimientos. */
  @Get('contratos/vencimientos')
  panel(
    @Query('dias') dias: string | undefined,
    @Req() request: unknown,
  ) {
    const rango = Number(dias);
    return this.renovaciones.panelVencimientos(
      construirContextoPeticion(request),
      Number.isFinite(rango) && rango > 0 ? rango : 90,
    );
  }

  /** R3 — generar alertas por umbral (solo admin, dedupe). */
  @Post('contratos/vencimientos/alertas')
  @Roles('admin')
  @Audit('crear', 'alerta_vencimiento')
  generarAlertas(@Req() request: unknown) {
    return this.renovaciones.generarAlertas(construirContextoPeticion(request));
  }

  /** R4 — renovación asistida. */
  @Post('contratos/:id/renovar')
  @Audit('renovar', 'contract')
  renovar(@Param('id') id: string, @Body() cuerpo: CuerpoRenovar, @Req() request: unknown) {
    const nuevoCanon =
      typeof cuerpo.nuevo_canon === 'number' && cuerpo.nuevo_canon > 0
        ? cuerpo.nuevo_canon
        : undefined;
    const nuevaFechaFin =
      typeof cuerpo.nueva_fecha_fin === 'string' && cuerpo.nueva_fecha_fin !== ''
        ? cuerpo.nueva_fecha_fin
        : undefined;
    return this.renovaciones.renovar(construirContextoPeticion(request), id, {
      nuevo_canon: nuevoCanon,
      nueva_fecha_fin: nuevaFechaFin,
    });
  }

  /** R5 — no renovación (desocupación + inventario de salida). */
  @Post('contratos/:id/no-renovar')
  @Audit('no_renovar', 'contract')
  async noRenovar(
    @Param('id') id: string,
    @Body() cuerpo: { motivo?: unknown },
    @Req() request: unknown,
  ) {
    const motivo =
      typeof cuerpo.motivo === 'string' && cuerpo.motivo.trim() !== ''
        ? cuerpo.motivo.trim().slice(0, 2000)
        : '';
    if (!motivo) {
      throw new BadRequestException('motivo es obligatorio.');
    }
    await this.renovaciones.noRenovar(construirContextoPeticion(request), id, motivo);
  }
}
