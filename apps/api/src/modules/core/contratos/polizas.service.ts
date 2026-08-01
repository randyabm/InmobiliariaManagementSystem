import { Injectable } from '@nestjs/common';
import type { InsurancePolicy } from '@inmobiliaria/types';

import type { ContextoPeticion } from '../../../common/database/cliente-tenant';
import { ResourceNotFoundError } from '../../../common/errors';
import { AlmacenamientoService } from '../almacenamiento/almacenamiento.service';
import { GeneradorPdfPdfLib, type GeneradorPdf } from '../inventarios/firma/generador-pdf';

/**
 * Póliza de arrendamiento (feature #20, R1–R3).
 */
@Injectable()
export class PolizasService {
  private readonly generador: GeneradorPdf = new GeneradorPdfPdfLib();

  constructor(private readonly almacenamiento: AlmacenamientoService) {}

  /** R1 — envío del candidato: póliza en_estudio. */
  async crear(
    ctx: ContextoPeticion,
    propertyId: string,
    datos: { aseguradora: string; observaciones?: string; contract_id?: string },
  ): Promise<InsurancePolicy> {
    const { rows: propiedad } = await ctx.cliente.query<{ id: string }>(
      `SELECT id FROM propiedad WHERE id = $1 AND tenant_id = $2`,
      [propertyId, ctx.tenantId],
    );
    if (propiedad.length === 0) throw new ResourceNotFoundError();
    if (datos.contract_id) {
      const { rows: contrato } = await ctx.cliente.query<{ id: string }>(
        `SELECT id FROM contract WHERE id = $1 AND tenant_id = $2`,
        [datos.contract_id, ctx.tenantId],
      );
      if (contrato.length === 0) throw new ResourceNotFoundError();
    }

    const { rows } = await ctx.cliente.query(
      `INSERT INTO insurance_policy
         (tenant_id, property_id, contract_id, aseguradora, observaciones)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, tenant_id::text AS tenant_id, property_id::text AS property_id,
                 contract_id::text AS contract_id, aseguradora, numero_poliza,
                 vigencia_desde, vigencia_hasta, valor_cobertura::text AS valor_cobertura,
                 estado, observaciones, created_at, updated_at`,
      [
        ctx.tenantId,
        propertyId,
        datos.contract_id ?? null,
        datos.aseguradora,
        datos.observaciones ?? null,
      ],
    );
    return aPoliza(rows[0]!);
  }

  /** R2 — resultado (aprobada/rechazada) y datos de la póliza. */
  async actualizar(
    ctx: ContextoPeticion,
    id: string,
    cambios: {
      estado?: 'aprobada' | 'rechazada';
      numero_poliza?: string;
      vigencia_desde?: string;
      vigencia_hasta?: string;
      valor_cobertura?: number;
      observaciones?: string;
    },
  ): Promise<InsurancePolicy> {
    await this.buscar(ctx, id);
    const asignaciones: string[] = ['updated_at = now()'];
    const valores: unknown[] = [];
    const set = <T>(campo: string, valor: T | undefined) => {
      if (valor !== undefined) {
        valores.push(valor);
        asignaciones.push(`${campo} = $${valores.length}`);
      }
    };
    set('estado', cambios.estado);
    set('numero_poliza', cambios.numero_poliza);
    set('vigencia_desde', cambios.vigencia_desde ? new Date(cambios.vigencia_desde) : undefined);
    set('vigencia_hasta', cambios.vigencia_hasta ? new Date(cambios.vigencia_hasta) : undefined);
    set('valor_cobertura', cambios.valor_cobertura);
    set('observaciones', cambios.observaciones);
    if (asignaciones.length > 1) {
      valores.push(id, ctx.tenantId);
      await ctx.cliente.query(
        `UPDATE insurance_policy SET ${asignaciones.join(', ')}
          WHERE id = $${valores.length - 1} AND tenant_id = $${valores.length}`,
        valores,
      );
    }
    return this.buscar(ctx, id);
  }

  /** R2 — subir el PDF de la póliza (repositorio documental, PA-20-1). */
  async subirDocumento(
    ctx: ContextoPeticion,
    id: string,
    binario: Buffer,
    mime: string,
  ): Promise<{ id_documento: string; hash_sha256: string }> {
    const poliza = await this.buscar(ctx, id);
    const subido = await this.almacenamiento.subir(binario, mime);
    const { rows } = await ctx.cliente.query<{ id: string }>(
      `INSERT INTO propiedad_documento
         (tenant_id, propiedad_id, nombre, tipo_documento, clave_storage,
          hash_sha256, mime, tamano_bytes, entidad_tipo, entidad_id, subido_por)
       VALUES ($1, $2, 'Póliza', 'poliza', $3, $4, $5, $6, 'poliza', $7, $8)
       RETURNING id`,
      [
        ctx.tenantId,
        poliza.property_id,
        subido.clave,
        subido.hash_sha256,
        mime,
        binario.length,
        poliza.id,
        ctx.actorId ?? null,
      ],
    );
    return { id_documento: rows[0]!.id, hash_sha256: subido.hash_sha256 };
  }

  async buscar(ctx: ContextoPeticion, id: string): Promise<InsurancePolicy> {
    const { rows } = await ctx.cliente.query(
      `SELECT id, tenant_id::text AS tenant_id, property_id::text AS property_id,
              contract_id::text AS contract_id, aseguradora, numero_poliza,
              vigencia_desde, vigencia_hasta, valor_cobertura::text AS valor_cobertura,
              estado, observaciones, created_at, updated_at
         FROM insurance_policy WHERE id = $1 AND tenant_id = $2`,
      [id, ctx.tenantId],
    );
    if (!rows[0]) throw new ResourceNotFoundError();
    return aPoliza(rows[0]);
  }

  async listarDePropiedad(
    ctx: ContextoPeticion,
    propertyId: string,
  ): Promise<InsurancePolicy[]> {
    const { rows } = await ctx.cliente.query(
      `SELECT id, tenant_id::text AS tenant_id, property_id::text AS property_id,
              contract_id::text AS contract_id, aseguradora, numero_poliza,
              vigencia_desde, vigencia_hasta, valor_cobertura::text AS valor_cobertura,
              estado, observaciones, created_at, updated_at
         FROM insurance_policy
        WHERE tenant_id = $1 AND property_id = $2 ORDER BY created_at`,
      [ctx.tenantId, propertyId],
    );
    return rows.map(aPoliza);
  }
}

interface FilaPoliza {
  id: string;
  tenant_id: string;
  property_id: string;
  contract_id: string | null;
  aseguradora: string;
  numero_poliza: string | null;
  vigencia_desde: Date | null;
  vigencia_hasta: Date | null;
  valor_cobertura: string | null;
  estado: 'en_estudio' | 'aprobada' | 'rechazada';
  observaciones: string | null;
  created_at: Date;
  updated_at: Date;
}

function aPoliza(fila: unknown): InsurancePolicy {
  const f = fila as FilaPoliza;
  return {
    id: f.id,
    tenant_id: f.tenant_id,
    property_id: f.property_id,
    contract_id: f.contract_id,
    aseguradora: f.aseguradora,
    numero_poliza: f.numero_poliza,
    vigencia_desde: f.vigencia_desde ? f.vigencia_desde.toISOString() : null,
    vigencia_hasta: f.vigencia_hasta ? f.vigencia_hasta.toISOString() : null,
    valor_cobertura: f.valor_cobertura !== null ? Number(f.valor_cobertura) : null,
    estado: f.estado,
    observaciones: f.observaciones,
    created_at: f.created_at.toISOString(),
    updated_at: f.updated_at.toISOString(),
  };
}
