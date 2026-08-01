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
import type { Propiedad, PropiedadConExtras } from '@inmobiliaria/types';

import { construirContextoPeticion } from '../../../common/database/cliente-tenant';
import { ZodValidationPipe } from '../../../common/validation/zod-validation.pipe';
import { Audit } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import type {
  ActualizarPropiedadDto,
  CrearPropiedadDto,
} from './dto/crear-propiedad.dto';
import { esquemaActualizarPropiedad, esquemaCrearPropiedad } from './dto/crear-propiedad.dto';
import { PropiedadesService } from './propiedades.service';

/**
 * Hoja de vida del inmueble (RF-P1). Feature #6.
 *
 * `@Roles('admin','empleado')` (R18). El `@Audit` de las mutaciones registra
 * la ficha con `entity_id` = id de la propiedad y `metadata` vacío (R15: ni
 * dirección, ni matrícula, ni contactos de administración).
 */
@Controller('propiedades')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(AuditInterceptor)
@Roles('admin', 'empleado')
export class PropiedadesController {
  constructor(private readonly propiedades: PropiedadesService) {}

  /** R5, R8, R9. */
  @Post()
  @Audit('crear', 'propiedad')
  async crear(
    @Body(new ZodValidationPipe(esquemaCrearPropiedad)) dto: CrearPropiedadDto,
    @Req() request: unknown,
  ): Promise<Propiedad> {
    return this.propiedades.crear(dto, construirContextoPeticion(request));
  }

  /** R5 (lista del tenant). */
  @Get()
  async listar(@Req() request: unknown): Promise<Propiedad[]> {
    return this.propiedades.listar(construirContextoPeticion(request));
  }

  /** R6, R8. */
  @Get(':id')
  async obtener(
    @Param('id') id: string,
    @Req() request: unknown,
  ): Promise<PropiedadConExtras> {
    return this.propiedades.obtener(id, construirContextoPeticion(request));
  }

  /** R7, R8, R9. */
  @Patch(':id')
  @Audit('actualizar', 'propiedad')
  async actualizar(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(esquemaActualizarPropiedad))
    dto: ActualizarPropiedadDto,
    @Req() request: unknown,
  ): Promise<Propiedad> {
    return this.propiedades.actualizar(id, dto, construirContextoPeticion(request));
  }

  /** R7 — baja lógica. */
  @Delete(':id')
  @Audit('baja', 'propiedad')
  async darDeBaja(
    @Param('id') id: string,
    @Req() request: unknown,
  ): Promise<void> {
    await this.propiedades.darDeBaja(id, construirContextoPeticion(request));
  }
}
