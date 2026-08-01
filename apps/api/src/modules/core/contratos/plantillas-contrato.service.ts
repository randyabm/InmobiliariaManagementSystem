import { Injectable } from '@nestjs/common';
import type { ContractTemplate } from '@inmobiliaria/types';

import type { ContextoPeticion } from '../../../common/database/cliente-tenant';
import { ResourceNotFoundError } from '../../../common/errors';
import { PlantillasContratoRepository } from './plantillas-contrato.repository';
import { PlantillaContratoYaExisteError } from './errors/plantilla-contrato-ya-existe.error';
import { PlantillaContratoInvalidaError } from './errors/plantilla-contrato-invalida.error';

/**
 * Plantillas de contrato (feature #16, R1–R4, PA-16-1..3).
 */
@Injectable()
export class PlantillasContratoService {
  constructor(private readonly repositorio: PlantillasContratoRepository) {}

  /** R1 — el clausulado común del tenant (404 si aún no existe). */
  async obtenerBase(ctx: ContextoPeticion): Promise<ContractTemplate> {
    const base = await this.repositorio.buscarBase(ctx);
    if (!base) throw new ResourceNotFoundError();
    return base;
  }

  /** R1 — crear la base (una sola por tenant, 409). */
  async crearBase(
    ctx: ContextoPeticion,
    datos: { nombre: string; cuerpo: string; merge_fields: Record<string, string> },
  ): Promise<ContractTemplate> {
    const existente = await this.repositorio.buscarBase(ctx);
    if (existente) throw new PlantillaContratoYaExisteError();
    validarMergeFields(datos.cuerpo, datos.merge_fields);
    return this.repositorio.insertarBase(ctx, {
      nombre: datos.nombre,
      cuerpo: datos.cuerpo,
      mergeFields: datos.merge_fields,
    });
  }

  /** R2 — editar la base; version++ si ya estaba validada. */
  async editarBase(
    ctx: ContextoPeticion,
    cambios: { nombre?: string; cuerpo?: string; merge_fields?: Record<string, string> },
  ): Promise<ContractTemplate> {
    const base = await this.repositorio.buscarBase(ctx);
    if (!base) throw new ResourceNotFoundError();
    if (cambios.cuerpo !== undefined || cambios.merge_fields !== undefined) {
      validarMergeFields(
        cambios.cuerpo ?? base.cuerpo,
        cambios.merge_fields ?? base.merge_fields_json,
      );
    }
    const version = base.estado === 'validado' ? base.version + 1 : base.version;
    await this.repositorio.actualizar(ctx, base.id, {
      nombre: cambios.nombre,
      cuerpo: cambios.cuerpo,
      mergeFields: cambios.merge_fields,
      version,
    });
    const actualizada = await this.repositorio.buscarBase(ctx);
    if (!actualizada) throw new ResourceNotFoundError();
    return actualizada;
  }

  /** R2 — validar la base (solo admin; el guard lo garantiza). */
  async validarBase(ctx: ContextoPeticion): Promise<ContractTemplate> {
    const base = await this.repositorio.buscarBase(ctx);
    if (!base) throw new ResourceNotFoundError();
    if (!ctx.actorId) throw new ResourceNotFoundError();
    await this.repositorio.actualizar(ctx, base.id, {
      estado: 'validado',
      validadoPor: ctx.actorId,
    });
    const actualizada = await this.repositorio.buscarBase(ctx);
    if (!actualizada) throw new ResourceNotFoundError();
    return actualizada;
  }

  /** R3 — borrador propuesto para la propiedad (copia + campos pre-rellenos). */
  async proponerParaPropiedad(
    ctx: ContextoPeticion,
    propertyId: string,
  ): Promise<ContractTemplate> {
    const existente = await this.repositorio.buscarPorPropiedad(ctx, propertyId);
    if (existente) throw new PlantillaContratoYaExisteError();

    const base = await this.repositorio.buscarBase(ctx);
    if (!base) throw new ResourceNotFoundError();

    // La propiedad debe existir y pertenecer al tenant.
    const { rows } = await ctx.cliente.query<{ id: string }>(
      `SELECT id FROM propiedad WHERE id = $1 AND tenant_id = $2`,
      [propertyId, ctx.tenantId],
    );
    if (rows.length === 0) throw new ResourceNotFoundError();

    // Campos de la propiedad pre-rellenos (RF-CT2, §13.2).
    const { rows: datos } = await ctx.cliente.query<{
      direccion: string;
      canon: string;
      valor_administracion: string | null;
      cuenta_nombre: string | null;
    }>(
      `SELECT p.direccion, p.canon::text AS canon,
              p.valor_administracion::text AS valor_administracion,
              cb.titular_nombre AS cuenta_nombre
         FROM propiedad p
         LEFT JOIN cuenta_bancaria cb ON cb.id = p.cuenta_bancaria_id
        WHERE p.id = $1 AND p.tenant_id = $2`,
      [propertyId, ctx.tenantId],
    );
    const fila = datos[0]!;
    const mergeFields: Record<string, string> = {
      ...base.merge_fields_json,
      direccion_propiedad: fila.direccion,
      canon: fila.canon,
      administracion: fila.valor_administracion ?? '',
      cuenta_canon: fila.cuenta_nombre ?? '',
    };

    return this.repositorio.insertarCopiaDePropiedad(ctx, {
      propertyId,
      nombre: `${base.nombre} — ${fila.direccion}`,
      cuerpo: base.cuerpo,
      mergeFields,
    });
  }

  /** R3 — la plantilla de la propiedad (404 si no existe). */
  async obtenerDePropiedad(ctx: ContextoPeticion, propertyId: string): Promise<ContractTemplate> {
    const plantilla = await this.repositorio.buscarPorPropiedad(ctx, propertyId);
    if (!plantilla) throw new ResourceNotFoundError();
    return plantilla;
  }

  /** R4 — validar la plantilla de la propiedad (solo admin). */
  async validarDePropiedad(ctx: ContextoPeticion, propertyId: string): Promise<ContractTemplate> {
    const plantilla = await this.repositorio.buscarPorPropiedad(ctx, propertyId);
    if (!plantilla) throw new ResourceNotFoundError();
    if (!ctx.actorId) throw new ResourceNotFoundError();
    await this.repositorio.actualizar(ctx, plantilla.id, {
      estado: 'validado',
      validadoPor: ctx.actorId,
    });
    const actualizada = await this.repositorio.buscarPorPropiedad(ctx, propertyId);
    if (!actualizada) throw new ResourceNotFoundError();
    return actualizada;
  }
}

/** PA-16-2 — cada `{campo}` del cuerpo debe existir en los merge fields. */
export function validarMergeFields(
  cuerpo: string,
  mergeFields: Record<string, string>,
): void {
  const campos = [...cuerpo.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]);
  const faltantes = [...new Set(campos)].filter(
    (c): c is string => typeof c === 'string' && !(c in mergeFields),
  );
  if (faltantes.length > 0) {
    throw new PlantillaContratoInvalidaError(
      `Merge fields sin definir: ${faltantes.join(', ')}.`,
    );
  }
}
