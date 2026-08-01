import {
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { DashboardPropiedades } from '@inmobiliaria/types';

import { construirContextoPeticion } from '../../../common/database/cliente-tenant';
import { ZodValidationPipe } from '../../../common/validation/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { DashboardService } from './dashboard.service';
import { z } from 'zod';
import { TIPOS_PROPIEDAD } from '@inmobiliaria/types';

/**
 * `GET /propiedades/dashboard` (RF-P5/RF-PI5/RF-PI6).
 *
 * Se registra ANTES que `PropiedadesController` en el módulo: Express
 * empareja en orden y `dashboard` nunca es un uuid, así que el segmento no
 * colisiona con `GET /propiedades/:id`.
 */
const esquemaFiltrosDashboard = z
  .object({
    estado: z.string().trim().min(1).max(60).optional(),
    tipo: z.enum(TIPOS_PROPIEDAD).optional(),
  })
  .strict();

type FiltrosDashboard = z.infer<typeof esquemaFiltrosDashboard>;

@Controller('propiedades')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors()
@Roles('admin', 'empleado')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('dashboard')
  async consultar(
    @Query(new ZodValidationPipe(esquemaFiltrosDashboard)) filtros: FiltrosDashboard,
    @Req() request: unknown,
  ): Promise<DashboardPropiedades> {
    return this.dashboard.consultar(filtros, construirContextoPeticion(request));
  }
}
