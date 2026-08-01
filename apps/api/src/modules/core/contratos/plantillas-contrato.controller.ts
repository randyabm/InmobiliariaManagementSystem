import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';

import { construirContextoPeticion } from '../../../common/database/cliente-tenant';
import { Audit } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { PlantillasContratoService } from './plantillas-contrato.service';

interface CuerpoBase {
  nombre?: unknown;
  cuerpo?: unknown;
  merge_fields?: unknown;
}

interface CuerpoEditar {
  nombre?: unknown;
  cuerpo?: unknown;
  merge_fields?: unknown;
}

/**
 * Plantillas de contrato (feature #16, R1–R4).
 *
 * Lectura y edición de la base: admin/empleado. Validación (base y copia
 * de propiedad): solo `admin` (PA-16-3, R4).
 */
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(AuditInterceptor)
@Roles('admin', 'empleado')
export class PlantillasContratoController {
  constructor(private readonly plantillas: PlantillasContratoService) {}

  /** R1 — el clausulado común del tenant. */
  @Get('plantillas-contrato')
  obtenerBase(@Req() request: unknown) {
    return this.plantillas.obtenerBase(construirContextoPeticion(request));
  }

  /** R1 — crear la base (409 si ya existe). */
  @Post('plantillas-contrato')
  @Audit('crear', 'contract_template')
  crearBase(@Body() cuerpo: CuerpoBase, @Req() request: unknown) {
    const { nombre, cuerpo: texto, mergeFields } = validarBase(cuerpo);
    return this.plantillas.crearBase(
      construirContextoPeticion(request),
      { nombre, cuerpo: texto, merge_fields: mergeFields },
    );
  }

  /** R2 — editar la base. */
  @Patch('plantillas-contrato')
  @Audit('actualizar', 'contract_template')
  editarBase(@Body() cuerpo: CuerpoEditar, @Req() request: unknown) {
    const cambios: { nombre?: string; cuerpo?: string; merge_fields?: Record<string, string> } = {};
    if (typeof cuerpo.nombre === 'string' && cuerpo.nombre.trim() !== '') {
      cambios.nombre = cuerpo.nombre.trim().slice(0, 200);
    }
    if (typeof cuerpo.cuerpo === 'string' && cuerpo.cuerpo.trim() !== '') {
      cambios.cuerpo = cuerpo.cuerpo;
    }
    if (cuerpo.merge_fields !== undefined) {
      if (
        typeof cuerpo.merge_fields !== 'object' ||
        cuerpo.merge_fields === null
      ) {
        throw new BadRequestException('merge_fields inválido.');
      }
      cambios.merge_fields = cuerpo.merge_fields as Record<string, string>;
    }
    return this.plantillas.editarBase(construirContextoPeticion(request), cambios);
  }

  /** R2 — validar la base (solo admin). */
  @Post('plantillas-contrato/validar')
  @Roles('admin')
  @Audit('validar', 'contract_template')
  validarBase(@Req() request: unknown) {
    return this.plantillas.validarBase(construirContextoPeticion(request));
  }

  /** R3 — borrador propuesto para la propiedad. */
  @Post('propiedades/:id/contrato/plantilla')
  @Audit('crear', 'contract_template')
  proponer(@Param('id') id: string, @Req() request: unknown) {
    return this.plantillas.proponerParaPropiedad(construirContextoPeticion(request), id);
  }

  /** R3 — la plantilla de la propiedad. */
  @Get('propiedades/:id/contrato/plantilla')
  obtenerDePropiedad(@Param('id') id: string, @Req() request: unknown) {
    return this.plantillas.obtenerDePropiedad(construirContextoPeticion(request), id);
  }

  /** R4 — validar la plantilla de la propiedad (solo admin). */
  @Post('propiedades/:id/contrato/plantilla/validar')
  @Roles('admin')
  @Audit('validar', 'contract_template')
  validarDePropiedad(@Param('id') id: string, @Req() request: unknown) {
    return this.plantillas.validarDePropiedad(construirContextoPeticion(request), id);
  }
}

function validarBase(cuerpo: CuerpoBase): {
  nombre: string;
  cuerpo: string;
  mergeFields: Record<string, string>;
} {
  const nombre = typeof cuerpo.nombre === 'string' ? cuerpo.nombre.trim().slice(0, 200) : '';
  const texto = typeof cuerpo.cuerpo === 'string' ? cuerpo.cuerpo : '';
  if (!nombre || !texto) {
    throw new BadRequestException('nombre y cuerpo son obligatorios.');
  }
  let mergeFields: Record<string, string>;
  if (cuerpo.merge_fields === undefined) {
    mergeFields = {};
  } else if (
    typeof cuerpo.merge_fields === 'object' &&
    cuerpo.merge_fields !== null
  ) {
    mergeFields = cuerpo.merge_fields as Record<string, string>;
  } else {
    throw new BadRequestException('merge_fields inválido.');
  }
  return { nombre, cuerpo: texto, mergeFields };
}
