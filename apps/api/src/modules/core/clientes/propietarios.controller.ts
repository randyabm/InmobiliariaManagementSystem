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
import type {
  HojaDeVidaPropietario,
  PerfilPropietario,
} from '@inmobiliaria/types';

import { construirContextoPeticion } from '../../../common/database/cliente-tenant';
import { ZodValidationPipe } from '../../../common/validation/zod-validation.pipe';
import { Audit } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  type ActualizarPropietarioDto,
  type BuscarPorDocumentoDto,
  type CrearPropietarioDto,
  esquemaActualizarPropietario,
  esquemaBuscarPorDocumento,
  esquemaCrearPropietario,
} from './dto/propietario.dto';
import { PropietariosService } from './propietarios.service';

/**
 * Hoja de vida del propietario (RF-C5, RF-C1, RF-C6).
 *
 * `@Roles('admin','empleado')` en **todas** las rutas (**R32**): un usuario
 * cuyo único rol activo en el tenant sea `propietario` o `inquilino` recibe
 * 403 del backend, no un botón oculto en el frontend.
 *
 * El controller no consulta la base de datos ni contiene lógica de negocio
 * (`docs/architecture.md`): valida la entrada con zod, construye el contexto
 * de la petición y delega en el servicio.
 */
@Controller('propietarios')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(AuditInterceptor)
@Roles('admin', 'empleado')
export class PropietariosController {
  constructor(private readonly propietarios: PropietariosService) {}

  /** **R10**, R16, R22, R24, R25, R26. */
  @Post()
  @Audit('crear', 'perfil_propietario')
  async crear(
    @Body(new ZodValidationPipe(esquemaCrearPropietario))
    dto: CrearPropietarioDto,
    @Req() request: unknown,
  ): Promise<PerfilPropietario> {
    return this.propietarios.crear(dto, construirContextoPeticion(request));
  }

  /** **R23**, R31 — búsqueda previa por documento, solo dentro del tenant. */
  @Get()
  async buscar(
    @Query(new ZodValidationPipe(esquemaBuscarPorDocumento))
    query: BuscarPorDocumentoDto,
    @Req() request: unknown,
  ): Promise<PerfilPropietario[]> {
    return this.propietarios.buscarPorDocumento(
      query.tipo_documento,
      query.documento,
      construirContextoPeticion(request),
    );
  }

  /** **R12**, R31 — sin `propiedades` (D-1) ni certificados (D-3). */
  @Get(':id')
  async obtener(
    @Param('id') id: string,
    @Req() request: unknown,
  ): Promise<HojaDeVidaPropietario> {
    return this.propietarios.obtener(id, construirContextoPeticion(request));
  }

  /** **R13**, R16, R31. */
  @Patch(':id')
  @Audit('actualizar', 'perfil_propietario')
  async actualizar(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(esquemaActualizarPropietario))
    dto: ActualizarPropietarioDto,
    @Req() request: unknown,
  ): Promise<PerfilPropietario> {
    return this.propietarios.actualizar(id, dto, construirContextoPeticion(request));
  }

  /** **R14**, R31 — baja lógica, nunca borrado físico. */
  @Delete(':id')
  @Audit('baja', 'perfil_propietario')
  async darDeBaja(
    @Param('id') id: string,
    @Req() request: unknown,
  ): Promise<void> {
    await this.propietarios.darDeBaja(id, construirContextoPeticion(request));
  }
}
