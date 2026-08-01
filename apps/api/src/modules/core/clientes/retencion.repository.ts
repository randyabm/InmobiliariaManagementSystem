import { Injectable } from '@nestjs/common';
import type { TarifaRetencion } from '@inmobiliaria/types';

import type { ContextoPeticion } from '../../../common/database/cliente-tenant';

/**
 * Único punto de acceso a `tarifa_retencion` (y al `sujeto_retencion` del
 * perfil que la resolución necesita leer) (**R1**, **R8**, **R10**).
 *
 * Mismas reglas que el resto de `clientes/`: solo el `PoolClient` de la
 * transacción con `SET LOCAL app.current_tenant` (**R22**) y `tenant_id`
 * explícito en cada consulta como defensa en profundidad sobre el RLS.
 *
 * `porcentaje::text` en el SQL: el `pg` ya devuelve `numeric` como cadena,
 * pero el casteo explícito fija el contrato (R11) y lo hace visible para el
 * revisor.
 */
@Injectable()
export class RetencionRepository {
  private static readonly SELECT = `
    SELECT id, tenant_id, anio, porcentaje::text AS porcentaje,
           created_at, updated_at
      FROM tarifa_retencion`;

  /** **R6** — upsert por (tenant_id, anio): una sola fila por año y tenant. */
  async establecer(
    ctx: ContextoPeticion,
    anio: number,
    porcentaje: string,
  ): Promise<TarifaRetencion> {
    const { rows } = await ctx.cliente.query(
      `${RetencionRepository.SELECT_INSERT_RETURNING}`,
      [ctx.tenantId, anio, porcentaje],
    );
    return aTarifa(rows[0]!);
  }

  private static readonly SELECT_INSERT_RETURNING = `
    INSERT INTO tarifa_retencion (tenant_id, anio, porcentaje)
    VALUES ($1, $2, $3)
    ON CONFLICT (tenant_id, anio)
    DO UPDATE SET porcentaje = EXCLUDED.porcentaje, updated_at = now()
    RETURNING id, tenant_id, anio, porcentaje::text AS porcentaje,
              created_at, updated_at`;

  /** **R7** — solo las del tenant de la petición, año descendente. */
  async listar(ctx: ContextoPeticion): Promise<TarifaRetencion[]> {
    const { rows } = await ctx.cliente.query(
      `${RetencionRepository.SELECT} WHERE tenant_id = $1 ORDER BY anio DESC`,
      [ctx.tenantId],
    );
    return rows.map(aTarifa);
  }

  /** **R8**, R9 — la tarifa de un año concreto; `null` si no está configurada. */
  async buscarPorAnio(
    ctx: ContextoPeticion,
    anio: number,
  ): Promise<TarifaRetencion | null> {
    const { rows } = await ctx.cliente.query(
      `${RetencionRepository.SELECT} WHERE tenant_id = $1 AND anio = $2`,
      [ctx.tenantId, anio],
    );
    return rows[0] ? aTarifa(rows[0]) : null;
  }

  /**
   * **R10** — la marca fiscal del propietario, solo si es de este tenant.
   *
   * `null` significa "no existe o es de otro tenant": el service lo traduce a
   * 404 indistinguible (**R19**), igual que el resto de `clientes/`.
   */
  async sujetoDeRetencion(
    ctx: ContextoPeticion,
    perfilPropietarioId: string,
  ): Promise<boolean | null> {
    const { rows } = await ctx.cliente.query<{ sujeto_retencion: boolean }>(
      `SELECT sujeto_retencion FROM perfil_propietario
        WHERE id = $1 AND tenant_id = $2`,
      [perfilPropietarioId, ctx.tenantId],
    );
    return rows[0]?.sujeto_retencion ?? null;
  }
}

interface FilaTarifaRetencion {
  id: string;
  tenant_id: string;
  anio: number;
  porcentaje: string;
  created_at: Date;
  updated_at: Date;
}

function aTarifa(fila: unknown): TarifaRetencion {
  const f = fila as FilaTarifaRetencion;
  return {
    id: f.id,
    tenant_id: f.tenant_id,
    anio: f.anio,
    porcentaje: f.porcentaje,
    created_at: f.created_at.toISOString(),
    updated_at: f.updated_at.toISOString(),
  };
}
