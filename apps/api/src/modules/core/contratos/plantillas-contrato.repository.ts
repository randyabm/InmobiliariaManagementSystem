import { Injectable } from '@nestjs/common';
import type { ContractTemplate, EstadoPlantillaContrato } from '@inmobiliaria/types';

import type { ContextoPeticion } from '../../../common/database/cliente-tenant';

/**
 * Plantillas de contrato (feature #16, R1–R4).
 *
 * Único acceso a `contract_template`, siempre con `tenant_id` explícito
 * (doble barrera: RLS + WHERE).
 */
@Injectable()
export class PlantillasContratoRepository {
  private static readonly SELECT = `
    SELECT id, tenant_id::text AS tenant_id, property_id::text AS property_id,
           nombre, cuerpo, merge_fields_json, version,
           validado_por::text AS validado_por, estado, created_at, updated_at
      FROM contract_template`;

  async buscarBase(ctx: ContextoPeticion): Promise<ContractTemplate | null> {
    const { rows } = await ctx.cliente.query(
      `${PlantillasContratoRepository.SELECT}
        WHERE tenant_id = $1 AND property_id IS NULL`,
      [ctx.tenantId],
    );
    return rows[0] ? aPlantilla(rows[0]) : null;
  }

  async insertarBase(
    ctx: ContextoPeticion,
    datos: { nombre: string; cuerpo: string; mergeFields: Record<string, string> },
  ): Promise<ContractTemplate> {
    const { rows } = await ctx.cliente.query(
      `INSERT INTO contract_template
         (tenant_id, nombre, cuerpo, merge_fields_json)
       VALUES ($1, $2, $3, $4)
       RETURNING id, tenant_id::text AS tenant_id, property_id::text AS property_id,
                 nombre, cuerpo, merge_fields_json, version,
                 validado_por::text AS validado_por, estado, created_at, updated_at`,
      [ctx.tenantId, datos.nombre, datos.cuerpo, JSON.stringify(datos.mergeFields)],
    );
    return aPlantilla(rows[0]!);
  }

  async actualizar(
    ctx: ContextoPeticion,
    id: string,
    cambios: {
      nombre?: string;
      cuerpo?: string;
      mergeFields?: Record<string, string>;
      version?: number;
      estado?: EstadoPlantillaContrato;
      validadoPor?: string;
    },
  ): Promise<void> {
    const asignaciones: string[] = ['updated_at = now()'];
    const valores: unknown[] = [];
    if (cambios.nombre !== undefined) {
      valores.push(cambios.nombre);
      asignaciones.push(`nombre = $${valores.length}`);
    }
    if (cambios.cuerpo !== undefined) {
      valores.push(cambios.cuerpo);
      asignaciones.push(`cuerpo = $${valores.length}`);
    }
    if (cambios.mergeFields !== undefined) {
      valores.push(JSON.stringify(cambios.mergeFields));
      asignaciones.push(`merge_fields_json = $${valores.length}`);
    }
    if (cambios.version !== undefined) {
      valores.push(cambios.version);
      asignaciones.push(`version = $${valores.length}`);
    }
    if (cambios.estado !== undefined) {
      valores.push(cambios.estado);
      asignaciones.push(`estado = $${valores.length}`);
    }
    if (cambios.validadoPor !== undefined) {
      valores.push(cambios.validadoPor);
      asignaciones.push(`validado_por = $${valores.length}`);
    }
    valores.push(id, ctx.tenantId);
    await ctx.cliente.query(
      `UPDATE contract_template SET ${asignaciones.join(', ')}
        WHERE id = $${valores.length - 1} AND tenant_id = $${valores.length}`,
      valores,
    );
  }

  async buscarPorPropiedad(
    ctx: ContextoPeticion,
    propertyId: string,
  ): Promise<ContractTemplate | null> {
    const { rows } = await ctx.cliente.query(
      `${PlantillasContratoRepository.SELECT}
        WHERE tenant_id = $1 AND property_id = $2`,
      [ctx.tenantId, propertyId],
    );
    return rows[0] ? aPlantilla(rows[0]) : null;
  }

  /** R3 — copia de la base con los campos de la propiedad (misma tx). */
  async insertarCopiaDePropiedad(
    ctx: ContextoPeticion,
    datos: {
      propertyId: string;
      nombre: string;
      cuerpo: string;
      mergeFields: Record<string, string>;
    },
  ): Promise<ContractTemplate> {
    const { rows } = await ctx.cliente.query(
      `INSERT INTO contract_template
         (tenant_id, property_id, nombre, cuerpo, merge_fields_json)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, tenant_id::text AS tenant_id, property_id::text AS property_id,
                 nombre, cuerpo, merge_fields_json, version,
                 validado_por::text AS validado_por, estado, created_at, updated_at`,
      [
        ctx.tenantId,
        datos.propertyId,
        datos.nombre,
        datos.cuerpo,
        JSON.stringify(datos.mergeFields),
      ],
    );
    return aPlantilla(rows[0]!);
  }
}

interface FilaPlantilla {
  id: string;
  tenant_id: string;
  property_id: string | null;
  nombre: string;
  cuerpo: string;
  merge_fields_json: unknown;
  version: number;
  validado_por: string | null;
  estado: EstadoPlantillaContrato;
  created_at: Date;
  updated_at: Date;
}

function aPlantilla(fila: unknown): ContractTemplate {
  const f = fila as FilaPlantilla;
  return {
    id: f.id,
    tenant_id: f.tenant_id,
    property_id: f.property_id,
    nombre: f.nombre,
    cuerpo: f.cuerpo,
    merge_fields_json:
      typeof f.merge_fields_json === 'object' && f.merge_fields_json !== null
        ? (f.merge_fields_json as Record<string, string>)
        : {},
    version: f.version,
    validado_por: f.validado_por,
    estado: f.estado,
    created_at: f.created_at.toISOString(),
    updated_at: f.updated_at.toISOString(),
  };
}
