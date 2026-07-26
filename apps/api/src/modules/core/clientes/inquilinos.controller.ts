import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { PerfilInquilino } from '@inmobiliaria/types';

import { construirContextoPeticion } from '../../../common/database/cliente-tenant';
import { ZodValidationPipe } from '../../../common/validation/zod-validation.pipe';
import { Audit } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  type ActualizarInquilinoDto,
  type CrearInquilinoDto,
  esquemaActualizarInquilino,
  esquemaCrearInquilino,
} from './dto/inquilino.dto';
import {
  type BuscarPorDocumentoDto,
  esquemaBuscarPorDocumento,
} from './dto/propietario.dto';
import { InquilinosService } from './inquilinos.service';

/**
 * Hoja de vida del inquilino (RF-C4, RF-C1, RF-C6).
 *
 * `@Roles('admin','empleado')` en las 5 rutas (**R32**).
 */
@Controller('inquilinos')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(AuditInterceptor)
@Roles('admin', 'empleado')
export class InquilinosController {
  constructor(private readonly inquilinos: InquilinosService) {}

  /** **R18**, R19, R22, R24, R25. */
  @Post()
  @Audit('crear', 'perfil_inquilino')
  async crear(
    @Body(new ZodValidationPipe(esquemaCrearInquilino)) dto: CrearInquilinoDto,
    @Req() request: unknown,
  ): Promise<PerfilInquilino> {
    return this.inquilinos.crear(dto, construirContextoPeticion(request));
  }

  /** **R23**, R31. */
  @Get()
  async buscar(
    @Query(new ZodValidationPipe(esquemaBuscarPorDocumento))
    query: BuscarPorDocumentoDto,
    @Req() request: unknown,
  ): Promise<PerfilInquilino[]> {
    return this.inquilinos.buscarPorDocumento(
      query.tipo_documento,
      query.documento,
      construirContextoPeticion(request),
    );
  }

  /** **R31**. */
  @Get(':id')
  async obtener(
    @Param('id') id: string,
    @Req() request: unknown,
  ): Promise<PerfilInquilino> {
    return this.inquilinos.obtener(id, construirContextoPeticion(request));
  }

  /** **R20**, R31. */
  @Patch(':id')
  @Audit('actualizar', 'perfil_inquilino')
  async actualizar(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(esquemaActualizarInquilino))
    dto: ActualizarInquilinoDto,
    @Req() request: unknown,
  ): Promise<PerfilInquilino> {
    return this.inquilinos.actualizar(id, dto, construirContextoPeticion(request));
  }

  /** **R21**, R31 — baja lógica. */
  @Delete(':id')
  @Audit('baja', 'perfil_inquilino')
  async darDeBaja(
    @Param('id') id: string,
    @Req() request: unknown,
  ): Promise<void> {
    await this.inquilinos.darDeBaja(id, construirContextoPeticion(request));
  }
}
