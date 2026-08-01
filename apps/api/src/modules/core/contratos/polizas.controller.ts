import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { construirContextoPeticion } from '../../../common/database/cliente-tenant';
import { Audit } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { PolizasService } from './polizas.service';

interface CuerpoCrear {
  aseguradora?: unknown;
  observaciones?: unknown;
  contract_id?: unknown;
}

interface CuerpoActualizar {
  estado?: unknown;
  numero_poliza?: unknown;
  vigencia_desde?: unknown;
  vigencia_hasta?: unknown;
  valor_cobertura?: unknown;
  observaciones?: unknown;
}

/**
 * Póliza de arrendamiento (feature #20, R1–R3). admin/empleado.
 */
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(AuditInterceptor)
@Roles('admin', 'empleado')
export class PolizasController {
  constructor(private readonly polizas: PolizasService) {}

  /** R1 — envío del candidato (póliza en_estudio). */
  @Post('propiedades/:id/polizas')
  @Audit('crear', 'insurance_policy')
  crear(@Param('id') propertyId: string, @Body() cuerpo: CuerpoCrear, @Req() request: unknown) {
    const aseguradora =
      typeof cuerpo.aseguradora === 'string' && cuerpo.aseguradora.trim() !== ''
        ? cuerpo.aseguradora.trim().slice(0, 200)
        : '';
    if (!aseguradora) {
      throw new BadRequestException('aseguradora es obligatoria.');
    }
    return this.polizas.crear(construirContextoPeticion(request), propertyId, {
      aseguradora,
      observaciones:
        typeof cuerpo.observaciones === 'string' ? cuerpo.observaciones.slice(0, 2000) : undefined,
      contract_id: typeof cuerpo.contract_id === 'string' ? cuerpo.contract_id : undefined,
    });
  }

  /** R3 — pólizas de la propiedad. */
  @Get('propiedades/:id/polizas')
  listarDePropiedad(@Param('id') propertyId: string, @Req() request: unknown) {
    return this.polizas.listarDePropiedad(construirContextoPeticion(request), propertyId);
  }

  /** R3 — detalle. */
  @Get('polizas/:id')
  obtener(@Param('id') id: string, @Req() request: unknown) {
    return this.polizas.buscar(construirContextoPeticion(request), id);
  }

  /** R2 — resultado y datos (aprobada/rechazada). */
  @Patch('polizas/:id')
  @Audit('actualizar', 'insurance_policy')
  actualizar(@Param('id') id: string, @Body() cuerpo: CuerpoActualizar, @Req() request: unknown) {
    const cambios: {
      estado?: 'aprobada' | 'rechazada';
      numero_poliza?: string;
      vigencia_desde?: string;
      vigencia_hasta?: string;
      valor_cobertura?: number;
      observaciones?: string;
    } = {};
    if (cuerpo.estado === 'aprobada' || cuerpo.estado === 'rechazada') {
      cambios.estado = cuerpo.estado;
    }
    if (typeof cuerpo.numero_poliza === 'string' && cuerpo.numero_poliza.trim() !== '') {
      cambios.numero_poliza = cuerpo.numero_poliza.trim().slice(0, 200);
    }
    if (typeof cuerpo.vigencia_desde === 'string') cambios.vigencia_desde = cuerpo.vigencia_desde;
    if (typeof cuerpo.vigencia_hasta === 'string') cambios.vigencia_hasta = cuerpo.vigencia_hasta;
    if (typeof cuerpo.valor_cobertura === 'number' && cuerpo.valor_cobertura >= 0) {
      cambios.valor_cobertura = cuerpo.valor_cobertura;
    }
    if (typeof cuerpo.observaciones === 'string') {
      cambios.observaciones = cuerpo.observaciones.slice(0, 2000);
    }
    return this.polizas.actualizar(construirContextoPeticion(request), id, cambios);
  }

  /** R2 — PDF de la póliza. */
  @Post('polizas/:id/documento')
  @UseInterceptors(FileInterceptor('archivo', { limits: { fileSize: 20 * 1024 * 1024 } }))
  @Audit('crear', 'propiedad_documento')
  subirDocumento(
    @Param('id') id: string,
    @UploadedFile() archivo: { buffer: Buffer; mimetype: string } | undefined,
    @Req() request: unknown,
  ) {
    if (!archivo?.buffer) {
      throw new BadRequestException('Se requiere un archivo.');
    }
    return this.polizas.subirDocumento(
      construirContextoPeticion(request),
      id,
      archivo.buffer,
      archivo.mimetype || 'application/pdf',
    );
  }
}
