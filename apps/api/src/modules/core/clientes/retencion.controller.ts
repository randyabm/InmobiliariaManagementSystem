import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { TarifaRetencion } from '@inmobiliaria/types';

import { construirContextoPeticion } from '../../../common/database/cliente-tenant';
import { ZodValidationPipe } from '../../../common/validation/zod-validation.pipe';
import { Audit } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  type AnioRuta,
  type EstablecerTarifaDto,
  esquemaAnio,
  esquemaEstablecerTarifa,
} from './dto/establecer-tarifa.dto';
import { RetencionService } from './retencion.service';

/**
 * Configuración de retención en la fuente por tenant y año (RF-C5, D-2).
 *
 * **Solo `admin`** (R21): la tarifa la fija la ley, pero quién la carga en el
 * sistema es una decisión del tenant; un `empleado` puede capturar perfiles
 * pero no configurar valores con consecuencias fiscales.
 *
 * El `@Audit` del PUT registra la mutación con `entity_id` = id de la tarifa
 * (R23); el `metadata` queda vacío — `porcentaje` no es dato personal, pero
 * aquí no hay nada que justifique copiarlo (R24).
 */
@Controller('configuracion/retencion')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(AuditInterceptor)
@Roles('admin')
export class RetencionController {
  constructor(private readonly retencion: RetencionService) {}

  /** **R7** — tarifas del tenant de la petición, ordenadas por año descendente. */
  @Get()
  async listar(@Req() request: unknown): Promise<TarifaRetencion[]> {
    return this.retencion.listar(construirContextoPeticion(request));
  }

  /** **R6**, R11 — registrar o reemplazar la tarifa de ESTE tenant para ese año. */
  @Put(':anio')
  @Audit('actualizar', 'tarifa_retencion')
  async establecer(
    @Param('anio', new ZodValidationPipe(esquemaAnio)) anio: AnioRuta,
    @Body(new ZodValidationPipe(esquemaEstablecerTarifa)) dto: EstablecerTarifaDto,
    @Req() request: unknown,
  ): Promise<TarifaRetencion> {
    return this.retencion.establecer(
      anio,
      dto.porcentaje,
      construirContextoPeticion(request),
    );
  }
}
