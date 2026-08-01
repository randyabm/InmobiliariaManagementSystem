import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { ReferenciaInquilino } from '@inmobiliaria/types';

import { construirContextoPeticion } from '../../../common/database/cliente-tenant';
import { ZodValidationPipe } from '../../../common/validation/zod-validation.pipe';
import { Audit } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import type { ActualizarReferenciaDto } from './dto/actualizar-referencia.dto';
import { esquemaActualizarReferencia } from './dto/actualizar-referencia.dto';
import type { CrearReferenciaDto } from './dto/crear-referencia.dto';
import { esquemaCrearReferencia } from './dto/crear-referencia.dto';
import { ReferenciasService } from './referencias.service';

/**
 * Referencias personales del inquilino (RF-C4, D-6).
 *
 * `@Roles('admin','empleado')` (R20). `@Audit` en las tres mutaciones (R23);
 * `telefono` y `email` de la referencia son de un tercero y nunca entran en
 * `metadata` (R24).
 */
@Controller('inquilinos/:idInquilino/referencias')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(AuditInterceptor)
@Roles('admin', 'empleado')
export class ReferenciasController {
  constructor(private readonly referencias: ReferenciasService) {}

  /** **R15**, R17. */
  @Post()
  @Audit('crear', 'referencia_inquilino')
  async crear(
    @Param('idInquilino') perfilInquilinoId: string,
    @Body(new ZodValidationPipe(esquemaCrearReferencia)) dto: CrearReferenciaDto,
    @Req() request: unknown,
  ): Promise<ReferenciaInquilino> {
    return this.referencias.crear(
      perfilInquilinoId,
      dto,
      construirContextoPeticion(request),
    );
  }

  /** **R16** — solo activas. */
  @Get()
  async listar(
    @Param('idInquilino') perfilInquilinoId: string,
    @Req() request: unknown,
  ): Promise<ReferenciaInquilino[]> {
    return this.referencias.listar(
      perfilInquilinoId,
      construirContextoPeticion(request),
    );
  }

  /** **R16** — PATCH parcial. */
  @Patch(':idReferencia')
  @Audit('actualizar', 'referencia_inquilino')
  async actualizar(
    @Param('idReferencia') id: string,
    @Body(new ZodValidationPipe(esquemaActualizarReferencia))
    dto: ActualizarReferenciaDto,
    @Req() request: unknown,
  ): Promise<ReferenciaInquilino> {
    return this.referencias.actualizar(
      id,
      dto,
      construirContextoPeticion(request),
    );
  }

  /** **R16** — baja lógica: la fila queda con `activo = false`. */
  @Delete(':idReferencia')
  @Audit('baja', 'referencia_inquilino')
  async darDeBaja(
    @Param('idReferencia') id: string,
    @Req() request: unknown,
  ): Promise<void> {
    await this.referencias.darDeBaja(id, construirContextoPeticion(request));
  }
}
