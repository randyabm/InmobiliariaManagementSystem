import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { CicloVidaDePropiedad } from '@inmobiliaria/types';

import { construirContextoPeticion } from '../../../common/database/cliente-tenant';
import { ZodValidationPipe } from '../../../common/validation/zod-validation.pipe';
import { Audit } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CicloVidaService } from './ciclo-vida.service';
import {
  type EjecutarCicloVidaDto,
  esquemaEjecutarCicloVida,
} from './dto/ciclo-vida.dto';

interface IdentidadDelToken {
  sub: string;
}

/**
 * Ciclo de vida de la propiedad (feature #8, RF-P4/RF-PI6).
 *
 * `@Roles('admin','empleado')` (R13). La ejecución registra la entrada de
 * `audit_log` con `entity_id` = id de la propiedad y `metadata` vacío (R7,
 * R15: el contexto no entra en la auditoría).
 */
@Controller('propiedades/:id/ciclo-vida')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(AuditInterceptor)
@Roles('admin', 'empleado')
export class CicloVidaController {
  constructor(private readonly cicloVida: CicloVidaService) {}

  /** R4 — estado actual y acciones disponibles para el actor. */
  @Get()
  async consultar(
    @Param('id') propiedadId: string,
    @Req() request: Request & { user?: IdentidadDelToken },
  ): Promise<CicloVidaDePropiedad> {
    const ctx = construirContextoPeticion(request);
    return this.cicloVida.consultar(
      propiedadId,
      request.user?.sub ?? '',
      ctx,
    );
  }

  /** R5, R6, R7 — ejecutar la acción del estado por su clave. */
  @Post('transiciones/:claveTransicion')
  @HttpCode(200)
  @Audit('actualizar', 'propiedad', (respuesta) =>
    (respuesta as { propiedad_id?: string } | null | undefined)?.propiedad_id,
  )
  async ejecutar(
    @Param('id') propiedadId: string,
    @Param('claveTransicion') claveTransicion: string,
    @Body(new ZodValidationPipe(esquemaEjecutarCicloVida)) dto: EjecutarCicloVidaDto,
    @Req() request: Request & { user?: IdentidadDelToken },
  ) {
    const ctx = construirContextoPeticion(request);
    return this.cicloVida.ejecutar(
      propiedadId,
      claveTransicion,
      dto.contexto,
      request.user?.sub ?? '',
      ctx,
    );
  }
}
