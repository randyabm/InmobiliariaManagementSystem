import { Injectable } from '@nestjs/common';
import type { CodigoOtp, PropositoOtp } from '@inmobiliaria/types';

import type { ContextoPeticion } from '../../../common/database/cliente-tenant';

/**
 * Código OTP (feature #13, R4, R5, R12).
 *
 * `codigo_hash` es SHA-256 del código de 6 dígitos; el valor en claro solo
 * viaja en la notificación (#10, PA-13-3). `verificado_en` marca el uso
 * único (R5).
 */
@Injectable()
export class OtpRepository {
  async insertar(
    ctx: ContextoPeticion,
    datos: { userId: string; proposito: PropositoOtp; codigoHash: string; expiraEn: Date },
  ): Promise<CodigoOtp> {
    const { rows } = await ctx.cliente.query(
      `INSERT INTO codigo_otp
         (tenant_id, user_id, proposito, codigo_hash, expira_en)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, tenant_id::text AS tenant_id, user_id::text AS user_id,
                 proposito, expira_en, verificado_en, created_at`,
      [ctx.tenantId, datos.userId, datos.proposito, datos.codigoHash, datos.expiraEn],
    );
    return aCodigo(rows[0]!);
  }

  /** El último OTP pendiente del usuario con ese propósito (dentro del RLS). */
  async buscarPendiente(
    ctx: ContextoPeticion,
    datos: { userId: string; proposito: PropositoOtp },
  ): Promise<(CodigoOtp & { codigo_hash: string }) | null> {
    const { rows } = await ctx.cliente.query(
      `SELECT id, tenant_id::text AS tenant_id, user_id::text AS user_id,
              proposito, codigo_hash, expira_en, verificado_en, created_at
         FROM codigo_otp
        WHERE tenant_id = $1 AND user_id = $2 AND proposito = $3
          AND verificado_en IS NULL AND expira_en > now()
        ORDER BY created_at DESC
        LIMIT 1`,
      [ctx.tenantId, datos.userId, datos.proposito],
    );
    return rows[0] ? { ...aCodigo(rows[0]), codigo_hash: (rows[0] as { codigo_hash: string }).codigo_hash } : null;
  }

  async marcarVerificado(ctx: ContextoPeticion, id: string): Promise<number> {
    const { rowCount } = await ctx.cliente.query(
      `UPDATE codigo_otp SET verificado_en = now()
        WHERE id = $1 AND tenant_id = $2 AND verificado_en IS NULL`,
      [id, ctx.tenantId],
    );
    return rowCount ?? 0;
  }

  /** R8 (#14) — el OTP de FIRMA verificado en los últimos 10 minutos. */
  async otpFirmaReciente(
    ctx: ContextoPeticion,
    userId: string,
  ): Promise<Date | null> {
    const { rows } = await ctx.cliente.query<{ verificado_en: Date }>(
      `SELECT verificado_en FROM codigo_otp
        WHERE tenant_id = $1 AND user_id = $2 AND proposito = 'FIRMA'
          AND verificado_en IS NOT NULL
          AND verificado_en > now() - interval '10 minutes'
        ORDER BY verificado_en DESC
        LIMIT 1`,
      [ctx.tenantId, userId],
    );
    return rows[0]?.verificado_en ?? null;
  }
}

interface FilaCodigo {
  id: string;
  tenant_id: string;
  user_id: string;
  proposito: PropositoOtp;
  expira_en: Date;
  verificado_en: Date | null;
  created_at: Date;
}

function aCodigo(fila: unknown): CodigoOtp {
  const f = fila as FilaCodigo;
  return {
    id: f.id,
    tenant_id: f.tenant_id,
    user_id: f.user_id,
    proposito: f.proposito,
    expira_en: f.expira_en.toISOString(),
    verificado_en: f.verificado_en ? f.verificado_en.toISOString() : null,
    created_at: f.created_at.toISOString(),
  };
}
