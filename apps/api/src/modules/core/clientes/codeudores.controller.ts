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
import type { CodeudorInquilino } from '@inmobiliaria/types';

import { construirContextoPeticion } from '../../../common/database/cliente-tenant';
import { ZodValidationPipe } from '../../../common/validation/zod-validation.pipe';
import { Audit } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CodeudoresService } from './codeudores.service';
import type { ActualizarCodeudorDto } from './dto/actualizar-codeudor.dto';
import { esquemaActualizarCodeudor } from './dto/actualizar-codeudor.dto';
import type { CrearCodeudorDto } from './dto/crear-codeudor.dto';
import { esquemaCrearCodeudor } from './dto/crear-codeudor.dto';

/**
 * Codeudores y coarrendatarios del inquilino (RF-C4, D-6).
 *
 * `@Roles('admin','empleado')` (R20). El `:id` de la raíz es el
 * `perfil_inquilino`; el del segmento de recurso, el codeudor. `@Audit` en
 * las tres mutaciones (R23) con `metadata` vacío: los datos del codeudor son
 * de un tercero y no entran en auditoría (R24).
 */
@Controller('inquilinos/:idInquilino/codeudores')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(AuditInterceptor)
@Roles('admin', 'empleado')
export class CodeudoresController {
  constructor(private readonly codeudores: CodeudoresService) {}

  /** **R12**, R14, R17. */
  @Post()
  @Audit('crear', 'codeudor_inquilino')
  async crear(
    @Param('idInquilino') perfilInquilinoId: string,
    @Body(new ZodValidationPipe(esquemaCrearCodeudor)) dto: CrearCodeudorDto,
    @Req() request: unknown,
  ): Promise<CodeudorInquilino> {
    return this.codeudores.crear(
      perfilInquilinoId,
      dto,
      construirContextoPeticion(request),
    );
  }

  /** **R13** — solo activos. */
  @Get()
  async listar(
    @Param('idInquilino') perfilInquilinoId: string,
    @Req() request: unknown,
  ): Promise<CodeudorInquilino[]> {
    return this.codeudores.listar(
      perfilInquilinoId,
      construirContextoPeticion(request),
    );
  }

  /** **R13** — PATCH parcial. */
  @Patch(':idCodeudor')
  @Audit('actualizar', 'codeudor_inquilino')
  async actualizar(
    @Param('idCodeudor') id: string,
    @Body(new ZodValidationPipe(esquemaActualizarCodeudor))
    dto: ActualizarCodeudorDto,
    @Req() request: unknown,
  ): Promise<CodeudorInquilino> {
    return this.codeudores.actualizar(
      id,
      dto,
      construirContextoPeticion(request),
    );
  }

  /** **R13** — baja lógica: la fila queda con `activo = false`. */
  @Delete(':idCodeudor')
  @Audit('baja', 'codeudor_inquilino')
  async darDeBaja(
    @Param('idCodeudor') id: string,
    @Req() request: unknown,
  ): Promise<void> {
    await this.codeudores.darDeBaja(id, construirContextoPeticion(request));
  }
}
