import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { HistorialOcupacion, Propiedad } from '@inmobiliaria/types';

import { construirContextoPeticion } from '../../../common/database/cliente-tenant';
import { ZodValidationPipe } from '../../../common/validation/zod-validation.pipe';
import { Audit } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { esquemaAsignarInquilinoActual } from './dto/acciones-propiedad.dto';
import { OcupacionService } from './ocupacion.service';
import { PropiedadesService } from './propiedades.service';

/**
 * Ocupación de la propiedad (RF-P3, R11, R12).
 *
 * `@Roles('admin','empleado')` (R18). El PATCH devuelve la ficha actualizada
 * para que el `@Audit` registre `entity_id` = id de la propiedad.
 */
@Controller('propiedades/:id')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(AuditInterceptor)
@Roles('admin', 'empleado')
export class OcupacionController {
  constructor(
    private readonly ocupacion: OcupacionService,
    private readonly propiedades: PropiedadesService,
  ) {}

  /** R11 — asignar o liberar el inquilino actual. */
  @Patch('inquilino-actual')
  @Audit('actualizar', 'propiedad')
  async asignarInquilinoActual(
    @Param('id') propiedadId: string,
    @Body(new ZodValidationPipe(esquemaAsignarInquilinoActual))
    dto: { perfil_inquilino_id: string | null },
    @Req() request: unknown,
  ): Promise<Propiedad> {
    await this.ocupacion.asignarInquilinoActual(
      propiedadId,
      dto.perfil_inquilino_id,
      construirContextoPeticion(request),
    );
    return this.propiedades.obtener(propiedadId, construirContextoPeticion(request));
  }

  /** R12 — la línea de tiempo, ordenada por `desde` descendente. */
  @Get('historial-ocupacion')
  async historial(
    @Param('id') propiedadId: string,
    @Req() request: unknown,
  ): Promise<HistorialOcupacion[]> {
    return this.ocupacion.historial(
      propiedadId,
      construirContextoPeticion(request),
    );
  }
}
