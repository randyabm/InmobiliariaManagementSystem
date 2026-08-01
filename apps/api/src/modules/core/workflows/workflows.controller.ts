import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type {
  DefinicionCompleta,
  InstanciaConDisponibles,
  WorkflowDefinicion,
  WorkflowInstancia,
  WorkflowTransicion,
} from '@inmobiliaria/types';

import { construirContextoPeticion } from '../../../common/database/cliente-tenant';
import { ZodValidationPipe } from '../../../common/validation/zod-validation.pipe';
import { Audit } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { DefinicionesService } from './definiciones.service';
import {
  type AnadirTransicionDto,
  type CrearInstanciaDto,
  type EjecutarTransicionDto,
  esquemaAnadirTransicion,
  esquemaCrearInstancia,
  esquemaEjecutarTransicion,
} from './dto/workflow.dto';
import { WorkflowService } from './workflow.service';

interface IdentidadDelToken {
  sub: string;
}

/**
 * Motor de workflows (feature #7).
 *
 * - Definiciones: lectura para admin/empleado; **gestión solo `admin`**
 *   (RF-W2: el Admin Inmobiliaria personaliza los pasos).
 * - Instancias y ejecución: admin/empleado (operaciones de negocio).
 *
 * El `@Audit` de las mutaciones registra `entity_id` del recurso y deja el
 * `metadata` vacío (R16: el contexto no entra en la auditoría).
 */
@Controller('workflows')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(AuditInterceptor)
@Roles('admin', 'empleado')
export class WorkflowsController {
  constructor(
    private readonly definiciones: DefinicionesService,
    private readonly workflow: WorkflowService,
  ) {}

  // ─── Definiciones ───────────────────────────────────────────────────────

  @Get()
  async listar(@Req() request: unknown): Promise<WorkflowDefinicion[]> {
    return this.definiciones.listar(construirContextoPeticion(request));
  }

  @Get(':id')
  async obtener(
    @Param('id') id: string,
    @Req() request: unknown,
  ): Promise<DefinicionCompleta> {
    return this.definiciones.obtener(id, construirContextoPeticion(request));
  }

  /** R4 — solo `admin`. */
  @Roles('admin')
  @Post(':id/clonar')
  @Audit('crear', 'workflow_definicion')
  async clonar(
    @Param('id') id: string,
    @Req() request: unknown,
  ): Promise<WorkflowDefinicion> {
    return this.definiciones.clonar(id, construirContextoPeticion(request));
  }

  /** R5 — solo `admin`. */
  @Roles('admin')
  @Post(':id/transiciones')
  @Audit('crear', 'workflow_transicion')
  async anadirTransicion(
    @Param('id') idDefinicion: string,
    @Body(new ZodValidationPipe(esquemaAnadirTransicion)) dto: AnadirTransicionDto,
    @Req() request: unknown,
  ): Promise<WorkflowTransicion> {
    return this.definiciones.anadirTransicion(
      idDefinicion,
      {
        clave: dto.clave,
        origenEstadoId: dto.origen_estado_id,
        destinoEstadoId: dto.destino_estado_id,
        tipoEjecucion: dto.tipo_ejecucion,
        rolesRequeridos: dto.roles_requeridos,
        condicion: dto.condicion,
        orden: dto.orden,
      },
      construirContextoPeticion(request),
    );
  }

  /** R5 — solo `admin`. */
  @Roles('admin')
  @Delete(':idDefinicion/transiciones/:idTransicion')
  @Audit('baja', 'workflow_transicion')
  async darDeBajaTransicion(
    @Param('idDefinicion') idDefinicion: string,
    @Param('idTransicion') idTransicion: string,
    @Req() request: unknown,
  ): Promise<void> {
    await this.definiciones.darDeBajaTransicion(
      idDefinicion,
      idTransicion,
      construirContextoPeticion(request),
    );
  }

  // ─── Instancias ─────────────────────────────────────────────────────────

  /** R6. */
  @Post(':id/instancias')
  @Audit('crear', 'workflow_instancia')
  async crearInstancia(
    @Param('id') definicionId: string,
    @Body(new ZodValidationPipe(esquemaCrearInstancia)) dto: CrearInstanciaDto,
    @Req() request: unknown,
  ): Promise<WorkflowInstancia> {
    return this.workflow.crearInstancia(
      definicionId,
      { entidadTipo: dto.entidad_tipo, entidadId: dto.entidad_id, contexto: dto.contexto },
      construirContextoPeticion(request),
    );
  }

  /** R9. */
  @Get('instancias/:idInstancia')
  async consultarInstancia(
    @Param('idInstancia') idInstancia: string,
    @Req() request: Request & { user?: IdentidadDelToken },
  ): Promise<InstanciaConDisponibles> {
    const ctx = construirContextoPeticion(request);
    return this.workflow.consultarInstancia(
      idInstancia,
      request.user?.sub ?? '',
      ctx,
    );
  }

  /** R7, R8. */
  @Post('instancias/:idInstancia/transiciones/:idTransicion')
  @HttpCode(200)
  @Audit('actualizar', 'workflow_instancia')
  async ejecutarTransicion(
    @Param('idInstancia') idInstancia: string,
    @Param('idTransicion') idTransicion: string,
    @Body(new ZodValidationPipe(esquemaEjecutarTransicion)) dto: EjecutarTransicionDto,
    @Req() request: Request & { user?: IdentidadDelToken },
  ): Promise<WorkflowInstancia> {
    const ctx = construirContextoPeticion(request);
    return this.workflow.ejecutarTransicion(
      idInstancia,
      idTransicion,
      dto.contexto,
      request.user?.sub ?? '',
      ctx,
    );
  }

  /** R11. */
  @Get('instancias/:idInstancia/historial')
  async historial(
    @Param('idInstancia') idInstancia: string,
    @Req() request: unknown,
  ) {
    return this.workflow.historial(idInstancia, construirContextoPeticion(request));
  }
}
