import {
  Body,
  Controller,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { PropiedadConExtras } from '@inmobiliaria/types';

import { construirContextoPeticion } from '../../../common/database/cliente-tenant';
import { ZodValidationPipe } from '../../../common/validation/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  type IngresoPropiedadDto,
  esquemaIngresoPropiedad,
} from './dto/ingreso.dto';
import { IngresoService } from './ingreso.service';

/**
 * Ingreso de propiedad (feature #9, RF-PI1/RF-PI2).
 *
 * `@Roles('admin','empleado')` (R10). **Sin `@Audit` a propósito:** las
 * mutaciones del ingreso (perfiles, propiedad, transiciones) ocurren dentro
 * del servicio y se auditan explícitamente allí (R8); un `@Audit` en este
 * controller duplicaría la entrada de la propiedad.
 */
@Controller('propiedades')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'empleado')
export class IngresoController {
  constructor(private readonly ingreso: IngresoService) {}

  /** R1, R2, R5, R6, R7. */
  @Post('ingreso')
  async ingresar(
    @Body(new ZodValidationPipe(esquemaIngresoPropiedad)) dto: IngresoPropiedadDto,
    @Req() request: unknown,
  ): Promise<PropiedadConExtras> {
    return this.ingreso.ingresar(dto, construirContextoPeticion(request));
  }
}
