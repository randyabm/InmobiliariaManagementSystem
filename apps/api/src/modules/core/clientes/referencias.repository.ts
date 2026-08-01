import { Injectable } from '@nestjs/common';
import type { ReferenciaInquilino } from '@inmobiliaria/types';

import type { ContextoPeticion } from '../../../common/database/cliente-tenant';

/**
 * Único punto de acceso a `referencia_inquilino` (**R3**, **R15**, **R16**).
 *
 * Mismas reglas que el resto de `clientes/`: solo el `PoolClient` de la
 * transacción con `SET LOCAL app.current_tenant` (**R22**) y `tenant_id`
 * explícito en cada consulta.
 *
 * Una referencia no es una identidad del sistema: no hay `user` detrás, y su
 * `telefono` y `email` son datos de contacto de un tercero que nunca entran
 * en logs ni en `audit_log.metadata` (R24).
 */
@Injectable()
export class ReferenciasRepository {
  private static readonly SELECT = `
    SELECT id, tenant_id, perfil_inquilino_id, nombre, telefono,
           relacion, email, activo, created_at, updated_at
      FROM referencia_inquilino`;

  async insertar(
    ctx: ContextoPeticion,
    datos: {
      perfilInquilinoId: string;
      nombre: string;
      telefono: string;
      relacion: string | null;
      email: string | null;
    },
  ): Promise<ReferenciaInquilino> {
    const { rows } = await ctx.cliente.query(
      `${ReferenciasRepository.SELECT_INSERT_RETURNING}`,
      [
        ctx.tenantId,
        datos.perfilInquilinoId,
        datos.nombre,
        datos.telefono,
        datos.relacion,
        datos.email,
      ],
    );
    return aReferencia(rows[0]!);
  }

  private static readonly SELECT_INSERT_RETURNING = `
    INSERT INTO referencia_inquilino
      (tenant_id, perfil_inquilino_id, nombre, telefono, relacion, email)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id, tenant_id, perfil_inquilino_id, nombre, telefono,
              relacion, email, activo, created_at, updated_at`;

  /** **R16** — solo activas, del tenant de la petición. */
  async listar(
    ctx: ContextoPeticion,
    perfilInquilinoId: string,
  ): Promise<ReferenciaInquilino[]> {
    const { rows } = await ctx.cliente.query(
      `${ReferenciasRepository.SELECT}
        WHERE tenant_id = $1 AND perfil_inquilino_id = $2 AND activo = true
        ORDER BY created_at`,
      [ctx.tenantId, perfilInquilinoId],
    );
    return rows.map(aReferencia);
  }

  async buscarPorId(
    ctx: ContextoPeticion,
    id: string,
  ): Promise<ReferenciaInquilino | null> {
    const { rows } = await ctx.cliente.query(
      `${ReferenciasRepository.SELECT} WHERE id = $1 AND tenant_id = $2`,
      [id, ctx.tenantId],
    );
    return rows[0] ? aReferencia(rows[0]) : null;
  }

  /** **R16** — PATCH parcial; devuelve las filas afectadas (0 = 404 en el service). */
  async actualizar(
    ctx: ContextoPeticion,
    id: string,
    cambios: {
      nombre?: string;
      telefono?: string;
      relacion?: string | null;
      email?: string | null;
    },
  ): Promise<number> {
    const asignaciones: string[] = [];
    const valores: unknown[] = [];

    if (cambios.nombre !== undefined) {
      valores.push(cambios.nombre);
      asignaciones.push(`nombre = $${valores.length}`);
    }
    if (cambios.telefono !== undefined) {
      valores.push(cambios.telefono);
      asignaciones.push(`telefono = $${valores.length}`);
    }
    if (cambios.relacion !== undefined) {
      valores.push(cambios.relacion);
      asignaciones.push(`relacion = $${valores.length}`);
    }
    if (cambios.email !== undefined) {
      valores.push(cambios.email);
      asignaciones.push(`email = $${valores.length}`);
    }

    asignaciones.push('updated_at = now()');
    valores.push(id, ctx.tenantId);

    const { rowCount } = await ctx.cliente.query(
      `UPDATE referencia_inquilino SET ${asignaciones.join(', ')}
        WHERE id = $${valores.length - 1} AND tenant_id = $${valores.length}`,
      valores,
    );
    return rowCount ?? 0;
  }

  /** **R16** — baja lógica, nada de borrado físico. */
  async marcarInactiva(ctx: ContextoPeticion, id: string): Promise<number> {
    const { rowCount } = await ctx.cliente.query(
      `UPDATE referencia_inquilino SET activo = false, updated_at = now()
        WHERE id = $1 AND tenant_id = $2`,
      [id, ctx.tenantId],
    );
    return rowCount ?? 0;
  }
}

interface FilaReferencia {
  id: string;
  tenant_id: string;
  perfil_inquilino_id: string;
  nombre: string;
  telefono: string;
  relacion: string | null;
  email: string | null;
  activo: boolean;
  created_at: Date;
  updated_at: Date;
}

function aReferencia(fila: unknown): ReferenciaInquilino {
  const f = fila as FilaReferencia;
  return {
    id: f.id,
    tenant_id: f.tenant_id,
    perfil_inquilino_id: f.perfil_inquilino_id,
    nombre: f.nombre,
    telefono: f.telefono,
    relacion: f.relacion,
    email: f.email,
    activo: f.activo,
    created_at: f.created_at.toISOString(),
    updated_at: f.updated_at.toISOString(),
  };
}
