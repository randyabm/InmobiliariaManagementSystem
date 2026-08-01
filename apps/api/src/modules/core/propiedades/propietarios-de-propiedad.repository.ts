import { Injectable } from '@nestjs/common';
import type { PropiedadPropietario } from '@inmobiliaria/types';

import type { ContextoPeticion } from '../../../common/database/cliente-tenant';

/**
 * Único punto de acceso a `propiedad_propietario` (R2, R10).
 *
 * El **principal** no vive aquí (está en `propiedad.propietario_principal_id`):
 * esta tabla guarda los propietarios ADICIONALES. La UNIQUE de la migración
 * impide asociar dos veces al mismo perfil; el service valida el resto.
 */
@Injectable()
export class PropietariosDePropiedadRepository {
  async insertar(
    ctx: ContextoPeticion,
    datos: { propiedadId: string; perfilPropietarioId: string },
  ): Promise<PropiedadPropietario> {
    const { rows } = await ctx.cliente.query(
      `INSERT INTO propiedad_propietario (tenant_id, propiedad_id, perfil_propietario_id)
       VALUES ($1, $2, $3)
       RETURNING id, tenant_id, propiedad_id, perfil_propietario_id, activo,
                 created_at, updated_at`,
      [ctx.tenantId, datos.propiedadId, datos.perfilPropietarioId],
    );
    return aAsociacion(rows[0]!);
  }

  async buscarActiva(
    ctx: ContextoPeticion,
    propiedadId: string,
    perfilPropietarioId: string,
  ): Promise<PropiedadPropietario | null> {
    const { rows } = await ctx.cliente.query(
      `SELECT id, tenant_id, propiedad_id, perfil_propietario_id, activo,
              created_at, updated_at
         FROM propiedad_propietario
        WHERE tenant_id = $1 AND propiedad_id = $2
          AND perfil_propietario_id = $3`,
      [ctx.tenantId, propiedadId, perfilPropietarioId],
    );
    return rows[0] ? aAsociacion(rows[0]) : null;
  }

  /** La asociación por su id (el `:idPropietario` de la ruta). */
  async buscarPorId(
    ctx: ContextoPeticion,
    id: string,
  ): Promise<PropiedadPropietario | null> {
    const { rows } = await ctx.cliente.query(
      `SELECT id, tenant_id, propiedad_id, perfil_propietario_id, activo,
              created_at, updated_at
         FROM propiedad_propietario
        WHERE id = $1 AND tenant_id = $2`,
      [id, ctx.tenantId],
    );
    return rows[0] ? aAsociacion(rows[0]) : null;
  }

  /** R10 — baja lógica de la asociación; devuelve filas afectadas (0 → 404). */
  async marcarInactiva(
    ctx: ContextoPeticion,
    id: string,
  ): Promise<number> {
    const { rowCount } = await ctx.cliente.query(
      `UPDATE propiedad_propietario SET activo = false, updated_at = now()
        WHERE id = $1 AND tenant_id = $2`,
      [id, ctx.tenantId],
    );
    return rowCount ?? 0;
  }
}

interface FilaAsociacion {
  id: string;
  tenant_id: string;
  propiedad_id: string;
  perfil_propietario_id: string;
  activo: boolean;
  created_at: Date;
  updated_at: Date;
}

function aAsociacion(fila: unknown): PropiedadPropietario {
  const f = fila as FilaAsociacion;
  return {
    id: f.id,
    tenant_id: f.tenant_id,
    propiedad_id: f.propiedad_id,
    perfil_propietario_id: f.perfil_propietario_id,
    activo: f.activo,
    created_at: f.created_at.toISOString(),
    updated_at: f.updated_at.toISOString(),
  };
}
