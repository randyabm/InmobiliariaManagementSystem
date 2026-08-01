import { Injectable } from '@nestjs/common';
import type { FirmaInventario, FirmanteTipo } from '@inmobiliaria/types';

import type { ContextoPeticion } from '../../../../common/database/cliente-tenant';

/**
 * Repositorio de la firma (feature #14, R3). Append-only por triggers:
 * aquí solo hay INSERT y SELECT.
 */
@Injectable()
export class FirmaPdfRepository {
  async insertarFirma(
    ctx: ContextoPeticion,
    datos: {
      inventarioId: string;
      firmanteTipo: FirmanteTipo;
      firmanteUserId: string;
      hashDocumento: string;
      ip: string;
      otpVerificadoEn?: Date;
    },
  ): Promise<FirmaInventario> {
    const { rows } = await ctx.cliente.query(
      `INSERT INTO inventario_firma
         (tenant_id, inventario_id, firmante_tipo, firmante_user_id,
          hash_documento, ip, otp_verificado_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, tenant_id::text AS tenant_id, inventario_id::text AS inventario_id,
                 firmante_tipo, firmante_user_id::text AS firmante_user_id,
                 hash_documento, ip, otp_verificado_en, created_at`,
      [
        ctx.tenantId,
        datos.inventarioId,
        datos.firmanteTipo,
        datos.firmanteUserId,
        datos.hashDocumento,
        datos.ip,
        datos.otpVerificadoEn ?? null,
      ],
    );
    return aFirma(rows[0]!);
  }

  async buscarFirmas(
    ctx: ContextoPeticion,
    inventarioId: string,
  ): Promise<FirmaInventario[]> {
    const { rows } = await ctx.cliente.query(
      `SELECT id, tenant_id::text AS tenant_id, inventario_id::text AS inventario_id,
              firmante_tipo, firmante_user_id::text AS firmante_user_id,
              hash_documento, ip, otp_verificado_en, created_at
         FROM inventario_firma
        WHERE tenant_id = $1 AND inventario_id = $2
        ORDER BY created_at`,
      [ctx.tenantId, inventarioId],
    );
    return rows.map(aFirma);
  }
}

interface FilaFirma {
  id: string;
  tenant_id: string;
  inventario_id: string;
  firmante_tipo: FirmanteTipo;
  firmante_user_id: string;
  hash_documento: string;
  ip: string;
  otp_verificado_en: Date | null;
  created_at: Date;
}

function aFirma(fila: unknown): FirmaInventario {
  const f = fila as FilaFirma;
  return {
    id: f.id,
    tenant_id: f.tenant_id,
    inventario_id: f.inventario_id,
    firmante_tipo: f.firmante_tipo,
    firmante_user_id: f.firmante_user_id,
    hash_documento: f.hash_documento,
    ip: f.ip,
    otp_verificado_en: f.otp_verificado_en ? f.otp_verificado_en.toISOString() : null,
    created_at: f.created_at.toISOString(),
  };
}
