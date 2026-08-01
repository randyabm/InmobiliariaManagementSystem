import { Injectable } from '@nestjs/common';
import type { Contrato, FirmaContrato } from '@inmobiliaria/types';

import type { ContextoPeticion } from '../../../common/database/cliente-tenant';

/**
 * Contrato y su firma (feature #17, R1–R4). La firma es append-only
 * (triggers); aquí solo INSERT y SELECT.
 */
@Injectable()
export class ContratosRepository {
  async insertarContrato(
    ctx: ContextoPeticion,
    datos: {
      propertyId: string;
      inquilinoId: string | null;
      propietarioId: string;
      fechaInicio: Date;
      fechaFin: Date;
    },
  ): Promise<Contrato> {
    const { rows } = await ctx.cliente.query(
      `INSERT INTO contract
         (tenant_id, property_id, inquilino_id, propietario_id, fecha_inicio, fecha_fin)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, tenant_id::text AS tenant_id, property_id::text AS property_id,
                 inquilino_id::text AS inquilino_id, propietario_id::text AS propietario_id,
                 fecha_inicio, fecha_fin, estado, created_at, updated_at`,
      [
        ctx.tenantId,
        datos.propertyId,
        datos.inquilinoId,
        datos.propietarioId,
        datos.fechaInicio,
        datos.fechaFin,
      ],
    );
    return aContrato(rows[0]!);
  }

  async buscarPorId(ctx: ContextoPeticion, id: string): Promise<Contrato | null> {
    const { rows } = await ctx.cliente.query(
      `SELECT id, tenant_id::text AS tenant_id, property_id::text AS property_id,
              inquilino_id::text AS inquilino_id, propietario_id::text AS propietario_id,
              fecha_inicio, fecha_fin, estado, created_at, updated_at
         FROM contract WHERE id = $1 AND tenant_id = $2`,
      [id, ctx.tenantId],
    );
    return rows[0] ? aContrato(rows[0]) : null;
  }

  async listar(
    ctx: ContextoPeticion,
    filtros: { propertyId?: string },
  ): Promise<Contrato[]> {
    const condiciones = ['tenant_id = $1'];
    const parametros: unknown[] = [ctx.tenantId];
    if (filtros.propertyId !== undefined) {
      parametros.push(filtros.propertyId);
      condiciones.push(`property_id = $${parametros.length}`);
    }
    const { rows } = await ctx.cliente.query(
      `SELECT id, tenant_id::text AS tenant_id, property_id::text AS property_id,
              inquilino_id::text AS inquilino_id, propietario_id::text AS propietario_id,
              fecha_inicio, fecha_fin, estado, created_at, updated_at
         FROM contract WHERE ${condiciones.join(' AND ')} ORDER BY created_at DESC`,
      parametros,
    );
    return rows.map(aContrato);
  }

  async actualizarEstado(
    ctx: ContextoPeticion,
    id: string,
    estado: 'vigente' | 'firmado',
  ): Promise<number> {
    const { rowCount } = await ctx.cliente.query(
      `UPDATE contract SET estado = $2, updated_at = now()
        WHERE id = $1 AND tenant_id = $3`,
      [id, estado, ctx.tenantId],
    );
    return rowCount ?? 0;
  }

  async insertarFirma(
    ctx: ContextoPeticion,
    datos: {
      contractId: string;
      firmanteTipo: 'EMPLEADO' | 'INQUILINO';
      firmanteUserId: string;
      hashDocumento: string;
      ip: string;
      otpVerificadoEn?: Date;
    },
  ): Promise<FirmaContrato> {
    const { rows } = await ctx.cliente.query(
      `INSERT INTO contrato_firma
         (tenant_id, contract_id, firmante_tipo, firmante_user_id,
          hash_documento, ip, otp_verificado_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, tenant_id::text AS tenant_id, contract_id::text AS contract_id,
                 firmante_tipo, firmante_user_id::text AS firmante_user_id,
                 hash_documento, ip, otp_verificado_en, created_at`,
      [
        ctx.tenantId,
        datos.contractId,
        datos.firmanteTipo,
        datos.firmanteUserId,
        datos.hashDocumento,
        datos.ip,
        datos.otpVerificadoEn ?? null,
      ],
    );
    return aFirma(rows[0]!);
  }

  async buscarFirmas(ctx: ContextoPeticion, contractId: string): Promise<FirmaContrato[]> {
    const { rows } = await ctx.cliente.query(
      `SELECT id, tenant_id::text AS tenant_id, contract_id::text AS contract_id,
              firmante_tipo, firmante_user_id::text AS firmante_user_id,
              hash_documento, ip, otp_verificado_en, created_at
         FROM contrato_firma WHERE tenant_id = $1 AND contract_id = $2
        ORDER BY created_at`,
      [ctx.tenantId, contractId],
    );
    return rows.map(aFirma);
  }
}

interface FilaContrato {
  id: string;
  tenant_id: string;
  property_id: string;
  inquilino_id: string;
  propietario_id: string;
  fecha_inicio: Date;
  fecha_fin: Date;
  estado: 'vigente' | 'firmado';
  created_at: Date;
  updated_at: Date;
}

function aContrato(fila: unknown): Contrato {
  const f = fila as FilaContrato;
  return {
    id: f.id,
    tenant_id: f.tenant_id,
    property_id: f.property_id,
    inquilino_id: f.inquilino_id,
    propietario_id: f.propietario_id,
    fecha_inicio: f.fecha_inicio.toISOString(),
    fecha_fin: f.fecha_fin.toISOString(),
    estado: f.estado,
    created_at: f.created_at.toISOString(),
    updated_at: f.updated_at.toISOString(),
  };
}

interface FilaFirma {
  id: string;
  tenant_id: string;
  contract_id: string;
  firmante_tipo: 'EMPLEADO' | 'INQUILINO';
  firmante_user_id: string;
  hash_documento: string;
  ip: string;
  otp_verificado_en: Date | null;
  created_at: Date;
}

function aFirma(fila: unknown): FirmaContrato {
  const f = fila as FilaFirma;
  return {
    id: f.id,
    tenant_id: f.tenant_id,
    contract_id: f.contract_id,
    firmante_tipo: f.firmante_tipo,
    firmante_user_id: f.firmante_user_id,
    hash_documento: f.hash_documento,
    ip: f.ip,
    otp_verificado_en: f.otp_verificado_en ? f.otp_verificado_en.toISOString() : null,
    created_at: f.created_at.toISOString(),
  };
}
