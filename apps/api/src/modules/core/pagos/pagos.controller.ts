import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { MapeoColumnas } from '@inmobiliaria/types';

import { construirContextoPeticion } from '../../../common/database/cliente-tenant';
import { Audit } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ImportacionesService } from './importaciones.service';

interface PeticionConForm {
  body?: { nombre_origen?: unknown };
  user?: { rol_activo?: string };
}

/**
 * Conciliación de pagos (feature #30, R1–R6, §15, D9). El sistema es un
 * espejo: nunca procesa pagos ni emite recibos.
 */
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(AuditInterceptor)
@Roles('admin', 'empleado')
export class PagosController {
  constructor(private readonly importaciones: ImportacionesService) {}

  /** R1 — cargar un archivo de pagos (CSV) con su nombre de origen. */
  @Post('pagos/importaciones')
  @UseInterceptors(FileInterceptor('archivo', { limits: { fileSize: 10 * 1024 * 1024 } }))
  @Audit('crear', 'payment_import')
  async cargar(
    @UploadedFile() archivo: { buffer: Buffer; originalname: string } | undefined,
    @Req() request: PeticionConForm,
  ) {
    if (!archivo?.buffer) {
      throw new BadRequestException('Se requiere un archivo.');
    }
    const nombreOrigen =
      typeof request.body?.nombre_origen === 'string' && request.body.nombre_origen.trim() !== ''
        ? request.body.nombre_origen.trim().slice(0, 200)
        : 'default';
    return this.importaciones.cargar(construirContextoPeticion(request), {
      nombreArchivo: archivo.originalname,
      binario: archivo.buffer,
      nombreOrigen,
    });
  }

  /** R1 — historial de importaciones. */
  @Get('pagos/importaciones')
  listar(@Req() request: unknown) {
    return this.importaciones.listarImportaciones(construirContextoPeticion(request));
  }

  /** R2 — confirmar el mapeo (y guardarlo como perfil reutilizable). */
  @Post('pagos/importaciones/:id/mapeo')
  @Audit('actualizar', 'payment_import')
  async confirmarMapeo(
    @Param('id') id: string,
    @Body() cuerpo: { mapeo?: unknown },
    @Req() request: unknown,
  ) {
    const mapeo = validarMapeo(cuerpo.mapeo);
    await this.importaciones.confirmarMapeo(construirContextoPeticion(request), id, mapeo);
  }

  /** R3, R4 — procesar la importación (parseo determinista + emparejamiento). */
  @Post('pagos/importaciones/:id/procesar')
  @Audit('procesar', 'payment_import')
  procesar(@Param('id') id: string, @Req() request: unknown) {
    return this.importaciones.procesar(construirContextoPeticion(request), id);
  }

  /** R4 — detalle con los tres grupos (sugeridos/sin identificar/pendientes). */
  @Get('pagos/importaciones/:id')
  async detalle(@Param('id') id: string, @Req() request: unknown) {
    const registros = await this.importaciones.registrosDeImportacion(
      construirContextoPeticion(request),
      id,
    );
    return {
      sugeridos: registros.filter((r) => r.estado === 'Sugerido'),
      sin_identificar: registros.filter((r) => r.estado === 'Sin_identificar'),
      pendientes: registros.filter((r) =>
        ['Cargado', 'Sugerido'].includes(r.estado),
      ),
      duplicados: registros.filter((r) => r.estado === 'Duplicado'),
    };
  }

  /** R5 — bandeja de excepciones: resolver o descartar un registro. */
  @Patch('pagos/registros/:id')
  @Audit('conciliar', 'payment_record')
  resolver(
    @Param('id') id: string,
    @Body() cuerpo: { contract_id?: unknown; descartar?: unknown },
    @Req() request: unknown,
  ) {
    const contractId = typeof cuerpo.contract_id === 'string' ? cuerpo.contract_id : undefined;
    return this.importaciones.resolverRegistro(construirContextoPeticion(request), id, {
      contract_id: contractId,
      descartar: cuerpo.descartar === true,
    });
  }

  /** R5 (RF-PA9) — referencia única de pago por contrato. */
  @Get('contratos/:id/referencia-pago')
  referencia(@Param('id') id: string, @Req() request: unknown) {
    return this.importaciones.referenciaDePago(construirContextoPeticion(request), id);
  }

  /** R6 — estado de cuenta del contrato (inquilino scoped). */
  @Get('contratos/:id/estado-cuenta')
  @Roles('admin', 'empleado', 'inquilino')
  estadoCuenta(@Param('id') id: string, @Req() request: PeticionConForm, @Query() _q: unknown) {
    const rol = request.user?.rol_activo ?? 'admin';
    return this.importaciones.estadoDeCuenta(construirContextoPeticion(request), id, rol);
  }
}

function validarMapeo(valor: unknown): MapeoColumnas {
  if (typeof valor !== 'object' || valor === null) {
    throw new BadRequestException('mapeo inválido.');
  }
  const mapeo: Record<string, string> = {};
  for (const [columna, campo] of Object.entries(valor as Record<string, unknown>)) {
    if (typeof campo !== 'string') {
      throw new BadRequestException('mapeo inválido.');
    }
    mapeo[columna] = campo;
  }
  return mapeo;
}
