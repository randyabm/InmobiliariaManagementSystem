import { Injectable } from '@nestjs/common';
import type { InvitacionInventario } from '@inmobiliaria/types';

import type { ContextoPeticion } from '../../../common/database/cliente-tenant';

/**
 * Invitación de revisión (feature #13, R1, R3, R12).
 *
 * `insertar` y `usar` corren dentro del RLS del tenant. La búsqueda del
 * bootstrap sin sesión pasa por la función `invitacion_por_token` (PA-13-4)
 * y luego TODO se revalida dentro del RLS.
 */
@Injectable()
export class InvitacionesRepository {
  async insertar(
    ctx: ContextoPeticion,
    datos: {
      inventarioId: string;
      perfilInquilinoId: string;
      tokenHash: string;
      expiraEn: Date;
    },
  ): Promise<InvitacionInventario> {
    const { rows } = await ctx.cliente.query(
      `INSERT INTO invitacion_inventario
         (tenant_id, inventario_id, perfil_inquilino_id, token_hash, expira_en)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, tenant_id::text AS tenant_id, inventario_id::text AS inventario_id,
                 perfil_inquilino_id::text AS perfil_inquilino_id,
                 expira_en, usada_en, created_at`,
      [
        ctx.tenantId,
        datos.inventarioId,
        datos.perfilInquilinoId,
        datos.tokenHash,
        datos.expiraEn,
      ],
    );
    return aInvitacion(rows[0]!);
  }

  /**
   * Bootstrap sin sesión ni tenant (R3): la función valida la coincidencia
   * EXACTA del hash (PA-13-4) y devuelve solo el mínimo.
   */
  async buscarPorHash(
    cliente: import('pg').PoolClient,
    tokenHash: string,
  ): Promise<{
    id: string;
    tenant_id: string;
    inventario_id: string;
    perfil_inquilino_id: string;
    expira_en: Date;
    usada_en: Date | null;
  } | null> {
    const { rows } = await cliente.query<{
      id: string;
      tenant_id: string;
      inventario_id: string;
      perfil_inquilino_id: string;
      expira_en: Date;
      usada_en: Date | null;
    }>('SELECT * FROM invitacion_por_token($1)', [tokenHash]);
    return rows[0] ?? null;
  }

  /** Relectura DENTRO del RLS: la función solo arranca el contexto (R19). */
  async buscarActiva(
    ctx: ContextoPeticion,
    id: string,
  ): Promise<InvitacionInventario | null> {
    const { rows } = await ctx.cliente.query(
      `SELECT id, tenant_id::text AS tenant_id, inventario_id::text AS inventario_id,
              perfil_inquilino_id::text AS perfil_inquilino_id,
              expira_en, usada_en, created_at
         FROM invitacion_inventario
        WHERE id = $1 AND tenant_id = $2 AND usada_en IS NULL
          AND expira_en > now()`,
      [id, ctx.tenantId],
    );
    return rows[0] ? aInvitacion(rows[0]) : null;
  }

  /** Marca la invitación como usada (una sola vez, R3). */
  async usar(
    ctx: ContextoPeticion,
    id: string,
  ): Promise<number> {
    const { rowCount } = await ctx.cliente.query(
      `UPDATE invitacion_inventario SET usada_en = now()
        WHERE id = $1 AND tenant_id = $2 AND usada_en IS NULL`,
      [id, ctx.tenantId],
    );
    return rowCount ?? 0;
  }
}

interface FilaInvitacion {
  id: string;
  tenant_id: string;
  inventario_id: string;
  perfil_inquilino_id: string;
  expira_en: Date;
  usada_en: Date | null;
  created_at: Date;
}

function aInvitacion(fila: unknown): InvitacionInventario {
  const f = fila as FilaInvitacion;
  return {
    id: f.id,
    tenant_id: f.tenant_id,
    inventario_id: f.inventario_id,
    perfil_inquilino_id: f.perfil_inquilino_id,
    expira_en: f.expira_en.toISOString(),
    usada_en: f.usada_en ? f.usada_en.toISOString() : null,
    created_at: f.created_at.toISOString(),
  };
}
