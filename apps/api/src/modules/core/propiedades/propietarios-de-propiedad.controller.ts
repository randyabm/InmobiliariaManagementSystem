import {
  Body,
  Controller,
  Delete,
  Param,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { PropiedadPropietario } from '@inmobiliaria/types';

import { construirContextoPeticion } from '../../../common/database/cliente-tenant';
import { ZodValidationPipe } from '../../../common/validation/zod-validation.pipe';
import { Audit } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { esquemaAnadirPropietario } from './dto/acciones-propiedad.dto';
import { PropietariosDePropiedadService } from './propietarios-de-propiedad.service';

/**
 * Propietarios adicionales de la propiedad (RF-P2, R10).
 *
 * `@Roles('admin','empleado')` (R18). El `:idPropietario` de la ruta de
 * baja es el id de la **asociación** (`propiedad_propietario.id`), no el del
 * perfil; el `@Audit` lo registra como `entity_id`.
 */
@Controller('propiedades/:idPropiedad/propietarios')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(AuditInterceptor)
@Roles('admin', 'empleado')
export class PropietariosDePropiedadController {
  constructor(private readonly propietarios: PropietariosDePropiedadService) {}

  /** R10. */
  @Post()
  @Audit('crear', 'propiedad_propietario')
  async anadir(
    @Param('idPropiedad') propiedadId: string,
    @Body(new ZodValidationPipe(esquemaAnadirPropietario))
    dto: { perfil_propietario_id: string },
    @Req() request: unknown,
  ): Promise<PropiedadPropietario> {
    return this.propietarios.anadir(
      propiedadId,
      dto.perfil_propietario_id,
      construirContextoPeticion(request),
    );
  }

  /** R10 — baja lógica de la asociación. */
  @Delete(':idPropietario')
  @Audit('baja', 'propiedad_propietario')
  async remover(
    @Param('idPropiedad') propiedadId: string,
    @Param('idPropietario') idAsociacion: string,
    @Req() request: unknown,
  ): Promise<void> {
    await this.propietarios.remover(
      propiedadId,
      idAsociacion,
      construirContextoPeticion(request),
    );
  }
}
