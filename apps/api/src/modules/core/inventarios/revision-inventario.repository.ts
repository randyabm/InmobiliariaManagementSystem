import { Injectable } from '@nestjs/common';
import type {
  InventarioCompleto,
  RespuestaRevision,
  RevisionItemInventario,
} from '@inmobiliaria/types';

import type { ContextoPeticion } from '../../../common/database/cliente-tenant';

/**
 * Revisión del inquilino (feature #13, R6, R7, R9).
 *
 * Todo acceso pasa por el SCOPING del perfil (R9): el inventario solo es
 * legible/revisable por el inquilino asignado (`perfil_inquilino_id`).
 */
@Injectable()
export class RevisionInventarioRepository {
  async perfilDelUsuario(
    ctx: ContextoPeticion,
    userId: string,
  ): Promise<string | null> {
    const { rows } = await ctx.cliente.query<{ id: string }>(
      `SELECT id FROM perfil_inquilino
        WHERE tenant_id = $1 AND user_id = $2`,
      [ctx.tenantId, userId],
    );
    return rows[0]?.id ?? null;
  }

  /** R9 — el inventario SOLO si pertenece al perfil del inquilino. */
  async buscarInventarioDelPerfil(
    ctx: ContextoPeticion,
    inventarioId: string,
    perfilInquilinoId: string,
  ): Promise<InventarioCompleto | null> {
    const { rows: inv } = await ctx.cliente.query(
      `SELECT id, tenant_id::text AS tenant_id, propiedad_id::text AS propiedad_id,
              perfil_inquilino_id::text AS perfil_inquilino_id,
              tipo_evento, estado, creado_por::text AS creado_por,
              revision_completada_en, activo, created_at, updated_at
         FROM inventario
        WHERE id = $1 AND tenant_id = $2 AND activo = true
          AND perfil_inquilino_id = $3`,
      [inventarioId, ctx.tenantId, perfilInquilinoId],
    );
    const fila = inv[0];
    if (!fila) return null;

    const { rows: zonas } = await ctx.cliente.query(
      `SELECT id, inventario_id, nombre, repetible, orden, plantilla_zona_id,
              activo, created_at
         FROM inventario_zona
        WHERE tenant_id = $1 AND inventario_id = $2 AND activo = true
        ORDER BY orden`,
      [ctx.tenantId, inventarioId],
    );
    const zonasCompletas = [];
    for (const zona of zonas) {
      const { rows: items } = await ctx.cliente.query(
        `SELECT id, zona_id, nombre, field_type, opciones_json, estado_checklist,
                valor_respuesta, comentario, foto_obligatoria, plantilla_item_id,
                creado_offline, sincronizado_en, activo, created_at, updated_at
           FROM inventario_item
          WHERE tenant_id = $1 AND zona_id = $2 AND activo = true
          ORDER BY created_at`,
        [ctx.tenantId, zona.id],
      );
      zonasCompletas.push({ ...zona, items });
    }

    return { ...fila, zonas: zonasCompletas };
  }

  async insertarRevision(
    ctx: ContextoPeticion,
    datos: {
      itemId: string;
      perfilInquilinoId: string;
      respuesta: RespuestaRevision;
      comentario: string | null;
    },
  ): Promise<RevisionItemInventario> {
    const { rows } = await ctx.cliente.query(
      `INSERT INTO inventario_item_revision
         (tenant_id, item_id, perfil_inquilino_id, respuesta, comentario)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, tenant_id::text AS tenant_id, item_id::text AS item_id,
                 perfil_inquilino_id::text AS perfil_inquilino_id,
                 respuesta, comentario, created_at`,
      [
        ctx.tenantId,
        datos.itemId,
        datos.perfilInquilinoId,
        datos.respuesta,
        datos.comentario,
      ],
    );
    return aRevision(rows[0]!);
  }

  async conteoItemsActivos(
    ctx: ContextoPeticion,
    inventarioId: string,
  ): Promise<number> {
    const { rows } = await ctx.cliente.query<{ total: string }>(
      `SELECT count(*)::text AS total
         FROM inventario_item i
         JOIN inventario_zona z ON z.id = i.zona_id
        WHERE z.inventario_id = $1 AND i.tenant_id = $2 AND i.activo = true
          AND z.activo = true`,
      [inventarioId, ctx.tenantId],
    );
    return Number(rows[0]?.total ?? 0);
  }

  async conteoRevisiones(
    ctx: ContextoPeticion,
    inventarioId: string,
    perfilInquilinoId: string,
  ): Promise<number> {
    const { rows } = await ctx.cliente.query<{ total: string }>(
      `SELECT count(*)::text AS total
         FROM inventario_item_revision r
         JOIN inventario_item i ON i.id = r.item_id
         JOIN inventario_zona z ON z.id = i.zona_id
        WHERE z.inventario_id = $1 AND r.tenant_id = $2
          AND r.perfil_inquilino_id = $3 AND i.activo = true AND z.activo = true`,
      [inventarioId, ctx.tenantId, perfilInquilinoId],
    );
    return Number(rows[0]?.total ?? 0);
  }

  /** R7 — marca la revisión completada y notifica al empleado (hook). */
  async marcarCompletada(
    ctx: ContextoPeticion,
    inventarioId: string,
  ): Promise<void> {
    await ctx.cliente.query(
      `UPDATE inventario SET revision_completada_en = now(), updated_at = now()
        WHERE id = $1 AND tenant_id = $2`,
      [inventarioId, ctx.tenantId],
    );
  }
}

interface FilaRevision {
  id: string;
  tenant_id: string;
  item_id: string;
  perfil_inquilino_id: string;
  respuesta: RespuestaRevision;
  comentario: string | null;
  created_at: Date;
}

function aRevision(fila: unknown): RevisionItemInventario {
  const f = fila as FilaRevision;
  return {
    id: f.id,
    tenant_id: f.tenant_id,
    item_id: f.item_id,
    perfil_inquilino_id: f.perfil_inquilino_id,
    respuesta: f.respuesta,
    comentario: f.comentario,
    created_at: f.created_at.toISOString(),
  };
}
