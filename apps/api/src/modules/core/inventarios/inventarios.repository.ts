import { Injectable } from '@nestjs/common';
import type {
  EstadoInventario,
  Inventario,
  InventarioCompleto,
  InventarioItem,
  InventarioItemFoto,
  InventarioZona,
  TipoEventoInventario,
} from '@inmobiliaria/types';

import type { ContextoPeticion } from '../../../common/database/cliente-tenant';
import type { PoolClient } from 'pg';

/**
 * Único punto de acceso a las cuatro tablas del inventario (feature #12).
 *
 * Mismas reglas que el resto del proyecto: solo el `PoolClient` de la
 * transacción con `SET LOCAL app.current_tenant` (R9) y `tenant_id`
 * explícito en cada consulta.
 */
@Injectable()
export class InventariosRepository {
  private static readonly SELECT_INVENTARIO = `
    SELECT id, tenant_id::text AS tenant_id, propiedad_id::text AS propiedad_id,
           tipo_evento, estado, creado_por::text AS creado_por,
           revision_completada_en, activo, created_at, updated_at
      FROM inventario`;

  private static readonly SELECT_ZONA = `
    SELECT id, inventario_id, nombre, repetible, orden, plantilla_zona_id,
           activo, created_at
      FROM inventario_zona`;

  private static readonly SELECT_ITEM = `
    SELECT id, zona_id, nombre, field_type, opciones_json, estado_checklist,
           valor_respuesta, comentario, foto_obligatoria, plantilla_item_id,
           creado_offline, sincronizado_en, activo, created_at, updated_at
      FROM inventario_item`;

  private static readonly SELECT_FOTO = `
    SELECT id, item_id, clave_storage, hash_sha256, autor, activo,
           fecha_captura AS created_at
      FROM inventario_item_foto`;

  // ─── Inventario ─────────────────────────────────────────────────────────

  async insertarInventario(
    ctx: ContextoPeticion,
    datos: {
      propiedadId: string;
      tipoEvento: TipoEventoInventario;
      creadoPor: string | null;
    },
  ): Promise<Inventario> {
    const { rows } = await ctx.cliente.query(
      `${InventariosRepository.SELECT_INVENTARIO_INSERT_RETURNING}`,
      [ctx.tenantId, datos.propiedadId, datos.tipoEvento, datos.creadoPor],
    );
    return aInventario(rows[0]!);
  }

  private static readonly SELECT_INVENTARIO_INSERT_RETURNING = `
    INSERT INTO inventario (tenant_id, propiedad_id, tipo_evento, creado_por)
    VALUES ($1, $2, $3, $4)
    RETURNING id, tenant_id::text AS tenant_id, propiedad_id::text AS propiedad_id,
              tipo_evento, estado, creado_por::text AS creado_por,
              revision_completada_en, activo, created_at, updated_at`;

  async buscarInventarioPorId(
    ctx: ContextoPeticion,
    id: string,
  ): Promise<Inventario | null> {
    const { rows } = await ctx.cliente.query(
      `${InventariosRepository.SELECT_INVENTARIO}
        WHERE id = $1 AND tenant_id = $2 AND activo = true`,
      [id, ctx.tenantId],
    );
    return rows[0] ? aInventario(rows[0]) : null;
  }

  async buscarBorrador(
    ctx: ContextoPeticion,
    propiedadId: string,
    tipoEvento: TipoEventoInventario,
  ): Promise<Inventario | null> {
    const { rows } = await ctx.cliente.query(
      `${InventariosRepository.SELECT_INVENTARIO}
        WHERE tenant_id = $1 AND propiedad_id = $2 AND tipo_evento = $3
          AND estado = 'BORRADOR' AND activo = true`,
      [ctx.tenantId, propiedadId, tipoEvento],
    );
    return rows[0] ? aInventario(rows[0]) : null;
  }

  async listar(
    ctx: ContextoPeticion,
    filtros: { propiedadId?: string; estado?: EstadoInventario; tipoEvento?: TipoEventoInventario },
  ): Promise<Inventario[]> {
    const condiciones = ['tenant_id = $1', 'activo = true'];
    const parametros: unknown[] = [ctx.tenantId];
    if (filtros.propiedadId !== undefined) {
      parametros.push(filtros.propiedadId);
      condiciones.push(`propiedad_id = $${parametros.length}`);
    }
    if (filtros.estado !== undefined) {
      parametros.push(filtros.estado);
      condiciones.push(`estado = $${parametros.length}`);
    }
    if (filtros.tipoEvento !== undefined) {
      parametros.push(filtros.tipoEvento);
      condiciones.push(`tipo_evento = $${parametros.length}`);
    }
    const { rows } = await ctx.cliente.query(
      `${InventariosRepository.SELECT_INVENTARIO}
        WHERE ${condiciones.join(' AND ')} ORDER BY created_at DESC`,
      parametros,
    );
    return rows.map(aInventario);
  }

  async actualizarEstado(
    ctx: ContextoPeticion,
    id: string,
    estado: EstadoInventario,
  ): Promise<number> {
    const { rowCount } = await ctx.cliente.query(
      `UPDATE inventario SET estado = $2, updated_at = now()
        WHERE id = $1 AND tenant_id = $3`,
      [id, estado, ctx.tenantId],
    );
    return rowCount ?? 0;
  }

  // ─── Zonas e ítems ──────────────────────────────────────────────────────

  async insertarZona(
    ctx: ContextoPeticion,
    datos: {
      inventarioId: string;
      nombre: string;
      repetible: boolean;
      orden: number;
      plantillaZonaId: string | null;
    },
  ): Promise<InventarioZona> {
    const { rows } = await ctx.cliente.query(
      `${InventariosRepository.SELECT_ZONA_INSERT_RETURNING}`,
      [ctx.tenantId, datos.inventarioId, datos.nombre, datos.repetible, datos.orden, datos.plantillaZonaId],
    );
    return aZona(rows[0]!);
  }

  private static readonly SELECT_ZONA_INSERT_RETURNING = `
    INSERT INTO inventario_zona
      (tenant_id, inventario_id, nombre, repetible, orden, plantilla_zona_id)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id, inventario_id, nombre, repetible, orden, plantilla_zona_id,
              activo, created_at`;

  async insertarItem(
    ctx: ContextoPeticion,
    datos: {
      zonaId: string;
      nombre: string;
      fieldType: string;
      opcionesJson: unknown;
      fotoObligatoria: boolean;
      plantillaItemId: string | null;
      creadoOffline?: boolean;
    },
  ): Promise<InventarioItem> {
    const { rows } = await ctx.cliente.query(
      `${InventariosRepository.SELECT_ITEM_INSERT_RETURNING}`,
      [
        ctx.tenantId,
        datos.zonaId,
        datos.nombre,
        datos.fieldType,
        datos.opcionesJson === null ? null : JSON.stringify(datos.opcionesJson),
        datos.fotoObligatoria,
        datos.plantillaItemId,
        datos.creadoOffline ?? false,
      ],
    );
    return aItem(rows[0]!);
  }

  private static readonly SELECT_ITEM_INSERT_RETURNING = `
    INSERT INTO inventario_item
      (tenant_id, zona_id, nombre, field_type, opciones_json, foto_obligatoria,
       plantilla_item_id, creado_offline)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id, zona_id, nombre, field_type, opciones_json, estado_checklist,
              valor_respuesta, comentario, foto_obligatoria, plantilla_item_id,
              creado_offline, sincronizado_en, activo, created_at, updated_at`;

  async buscarZona(
    ctx: ContextoPeticion,
    id: string,
  ): Promise<InventarioZona | null> {
    const { rows } = await ctx.cliente.query(
      `${InventariosRepository.SELECT_ZONA} WHERE id = $1 AND tenant_id = $2`,
      [id, ctx.tenantId],
    );
    return rows[0] ? aZona(rows[0]) : null;
  }

  async buscarItem(
    ctx: ContextoPeticion,
    id: string,
  ): Promise<InventarioItem | null> {
    const { rows } = await ctx.cliente.query(
      `${InventariosRepository.SELECT_ITEM} WHERE id = $1 AND tenant_id = $2`,
      [id, ctx.tenantId],
    );
    return rows[0] ? aItem(rows[0]) : null;
  }

  async actualizarZona(
    ctx: ContextoPeticion,
    id: string,
    cambios: Partial<{ nombre: string; orden: number; repetible: boolean }>,
  ): Promise<number> {
    const asignaciones: string[] = [];
    const valores: unknown[] = [];
    if (cambios.nombre !== undefined) {
      valores.push(cambios.nombre);
      asignaciones.push(`nombre = $${valores.length}`);
    }
    if (cambios.orden !== undefined) {
      valores.push(cambios.orden);
      asignaciones.push(`orden = $${valores.length}`);
    }
    if (cambios.repetible !== undefined) {
      valores.push(cambios.repetible);
      asignaciones.push(`repetible = $${valores.length}`);
    }
    if (asignaciones.length === 0) return 0;
    valores.push(id, ctx.tenantId);
    const { rowCount } = await ctx.cliente.query(
      `UPDATE inventario_zona SET ${asignaciones.join(', ')}
        WHERE id = $${valores.length - 1} AND tenant_id = $${valores.length}`,
      valores,
    );
    return rowCount ?? 0;
  }

  async actualizarItem(
    ctx: ContextoPeticion,
    id: string,
    cambios: Partial<{
      estadoChecklist: string | null;
      valorRespuesta: unknown;
      comentario: string | null;
      sincronizadoEn: Date | null;
    }>,
  ): Promise<number> {
    const asignaciones: string[] = [];
    const valores: unknown[] = [];
    if (cambios.estadoChecklist !== undefined) {
      valores.push(cambios.estadoChecklist);
      asignaciones.push(`estado_checklist = $${valores.length}`);
    }
    if (cambios.valorRespuesta !== undefined) {
      valores.push(
        cambios.valorRespuesta === null ? null : JSON.stringify(cambios.valorRespuesta),
      );
      asignaciones.push(`valor_respuesta = $${valores.length}`);
    }
    if (cambios.comentario !== undefined) {
      valores.push(cambios.comentario);
      asignaciones.push(`comentario = $${valores.length}`);
    }
    if (cambios.sincronizadoEn !== undefined) {
      valores.push(cambios.sincronizadoEn);
      asignaciones.push(`sincronizado_en = $${valores.length}`);
    }
    if (asignaciones.length === 0) return 0;
    asignaciones.push('updated_at = now()');
    valores.push(id, ctx.tenantId);
    const { rowCount } = await ctx.cliente.query(
      `UPDATE inventario_item SET ${asignaciones.join(', ')}
        WHERE id = $${valores.length - 1} AND tenant_id = $${valores.length}`,
      valores,
    );
    return rowCount ?? 0;
  }

  async marcarZonaInactiva(ctx: ContextoPeticion, id: string): Promise<number> {
    const { rowCount } = await ctx.cliente.query(
      `UPDATE inventario_zona SET activo = false
        WHERE id = $1 AND tenant_id = $2`,
      [id, ctx.tenantId],
    );
    return rowCount ?? 0;
  }

  async marcarItemInactivo(ctx: ContextoPeticion, id: string): Promise<number> {
    const { rowCount } = await ctx.cliente.query(
      `UPDATE inventario_item SET activo = false, updated_at = now()
        WHERE id = $1 AND tenant_id = $2`,
      [id, ctx.tenantId],
    );
    return rowCount ?? 0;
  }

  /** R6 — reordenar zonas: orden = índice de la lista enviada. */
  async reordenarZonas(
    ctx: ContextoPeticion,
    idsEnOrden: string[],
  ): Promise<number> {
    let afectadas = 0;
    for (let i = 0; i < idsEnOrden.length; i++) {
      const { rowCount } = await ctx.cliente.query(
        `UPDATE inventario_zona SET orden = $1
          WHERE id = $2 AND tenant_id = $3`,
        [i, idsEnOrden[i], ctx.tenantId],
      );
      afectadas += rowCount ?? 0;
    }
    return afectadas;
  }

  // ─── Lectura completa ───────────────────────────────────────────────────

  async buscarCompleto(
    ctx: ContextoPeticion,
    id: string,
  ): Promise<InventarioCompleto | null> {
    const inventario = await this.buscarInventarioPorId(ctx, id);
    if (!inventario) return null;

    const { rows: zonas } = await ctx.cliente.query(
      `${InventariosRepository.SELECT_ZONA}
        WHERE tenant_id = $1 AND inventario_id = $2 AND activo = true
        ORDER BY orden`,
      [ctx.tenantId, id],
    );

    const zonasCompletas = [];
    for (const filaZona of zonas) {
      const zona = aZona(filaZona);
      const { rows: items } = await ctx.cliente.query(
        `${InventariosRepository.SELECT_ITEM}
          WHERE tenant_id = $1 AND zona_id = $2 AND activo = true
          ORDER BY created_at`,
        [ctx.tenantId, zona.id],
      );
      const itemsCompletos = [];
      for (const filaItem of items) {
        const item = aItem(filaItem);
        const { rows: fotos } = await ctx.cliente.query(
          `${InventariosRepository.SELECT_FOTO}
            WHERE tenant_id = $1 AND item_id = $2 AND activo = true
            ORDER BY created_at`,
          [ctx.tenantId, item.id],
        );
        itemsCompletos.push({ ...item, fotos: fotos.map(aFoto) });
      }
      zonasCompletas.push({ ...zona, items: itemsCompletos });
    }

    return { ...inventario, zonas: zonasCompletas };
  }

  // ─── Materialización (R4) ───────────────────────────────────────────────

  /** Copia zonas e ítems ACTIVOS de la plantilla al inventario (misma tx). */
  async materializarPlantilla(
    cliente: PoolClient,
    plantillaId: string,
    inventarioId: string,
    tenantId: string,
  ): Promise<void> {
    const { rows: zonas } = await cliente.query<{ id: string; nombre: string; repetible: boolean; orden: number }>(
      `SELECT id, nombre, repetible, orden FROM plantilla_zona
        WHERE plantilla_id = $1 AND activo = true ORDER BY orden`,
      [plantillaId],
    );
    for (const zona of zonas) {
      const { rows: zonaNueva } = await cliente.query<{ id: string }>(
        `INSERT INTO inventario_zona
           (tenant_id, inventario_id, nombre, repetible, orden, plantilla_zona_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [tenantId, inventarioId, zona.nombre, zona.repetible, zona.orden, zona.id],
      );
      await cliente.query(
        `INSERT INTO inventario_item
           (tenant_id, zona_id, nombre, field_type, opciones_json,
            foto_obligatoria, plantilla_item_id)
         SELECT $1, $2, nombre, field_type, opciones_json,
                foto_obligatoria, id
           FROM plantilla_item
          WHERE zona_id = $3 AND activo = true
          ORDER BY orden`,
        [tenantId, zonaNueva[0]!.id, zona.id],
      );
    }
  }

  // ─── Fotos ──────────────────────────────────────────────────────────────

  async insertarFoto(
    ctx: ContextoPeticion,
    datos: {
      itemId: string;
      claveStorage: string;
      hashSha256: string;
      autor: 'EMPLEADO' | 'INQUILINO';
    },
  ): Promise<InventarioItemFoto> {
    const { rows } = await ctx.cliente.query(
      `${InventariosRepository.SELECT_FOTO_INSERT_RETURNING}`,
      [ctx.tenantId, datos.itemId, datos.claveStorage, datos.hashSha256, datos.autor],
    );
    return aFoto(rows[0]!);
  }

  private static readonly SELECT_FOTO_INSERT_RETURNING = `
    INSERT INTO inventario_item_foto (tenant_id, item_id, clave_storage, hash_sha256, autor)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id, item_id, clave_storage, hash_sha256, autor, activo,
              fecha_captura AS created_at`;

  async buscarFoto(ctx: ContextoPeticion, id: string): Promise<InventarioItemFoto | null> {
    const { rows } = await ctx.cliente.query(
      `${InventariosRepository.SELECT_FOTO} WHERE id = $1 AND tenant_id = $2`,
      [id, ctx.tenantId],
    );
    return rows[0] ? aFoto(rows[0]) : null;
  }

  async marcarFotoInactiva(ctx: ContextoPeticion, id: string): Promise<number> {
    const { rowCount } = await ctx.cliente.query(
      `UPDATE inventario_item_foto SET activo = false
        WHERE id = $1 AND tenant_id = $2`,
      [id, ctx.tenantId],
    );
    return rowCount ?? 0;
  }

  /**
   * R5 — baja lógica del borrador y de su snapshot (fotos → ítems → zonas →
   * inventario). El rol de aplicación jamás hace DELETE (`rol-aplicacion.ts`,
   * «Nunca borrar»): las filas mueren con `activo = false`.
   */
  async bajaLogicaCompleta(ctx: ContextoPeticion, id: string): Promise<void> {
    await ctx.cliente.query(
      `UPDATE inventario_item_foto SET activo = false
        WHERE tenant_id = $1 AND item_id IN (
          SELECT id FROM inventario_item
           WHERE tenant_id = $1 AND zona_id IN (
             SELECT id FROM inventario_zona WHERE tenant_id = $1 AND inventario_id = $2))`,
      [ctx.tenantId, id],
    );
    await ctx.cliente.query(
      `UPDATE inventario_item SET activo = false
        WHERE tenant_id = $1 AND zona_id IN (
          SELECT id FROM inventario_zona WHERE tenant_id = $1 AND inventario_id = $2)`,
      [ctx.tenantId, id],
    );
    await ctx.cliente.query(
      `UPDATE inventario_zona SET activo = false
        WHERE tenant_id = $1 AND inventario_id = $2`,
      [ctx.tenantId, id],
    );
    await ctx.cliente.query(
      `UPDATE inventario SET activo = false, updated_at = now()
        WHERE id = $1 AND tenant_id = $2`,
      [id, ctx.tenantId],
    );
  }
}

interface FilaInventario {
  id: string;
  tenant_id: string;
  propiedad_id: string;
  tipo_evento: TipoEventoInventario;
  estado: EstadoInventario;
  creado_por: string | null;
  revision_completada_en: Date | null;
  activo: boolean;
  created_at: Date;
  updated_at: Date;
}

function aInventario(fila: unknown): Inventario {
  const f = fila as FilaInventario;
  return {
    id: f.id,
    tenant_id: f.tenant_id,
    propiedad_id: f.propiedad_id,
    tipo_evento: f.tipo_evento,
    estado: f.estado,
    creado_por: f.creado_por,
    revision_completada_en: f.revision_completada_en
      ? f.revision_completada_en.toISOString()
      : null,
    activo: f.activo,
    created_at: f.created_at.toISOString(),
    updated_at: f.updated_at.toISOString(),
  };
}

interface FilaZona {
  id: string;
  inventario_id: string;
  nombre: string;
  repetible: boolean;
  orden: number;
  plantilla_zona_id: string | null;
  activo: boolean;
  created_at: Date;
}

function aZona(fila: unknown): InventarioZona {
  const f = fila as FilaZona;
  return {
    id: f.id,
    inventario_id: f.inventario_id,
    nombre: f.nombre,
    repetible: f.repetible,
    orden: f.orden,
    plantilla_zona_id: f.plantilla_zona_id,
    activo: f.activo,
    created_at: f.created_at.toISOString(),
  };
}

interface FilaItem {
  id: string;
  zona_id: string;
  nombre: string;
  field_type: string;
  opciones_json: unknown;
  estado_checklist: 'BUENO' | 'REGULAR' | 'MALO' | null;
  valor_respuesta: unknown;
  comentario: string | null;
  foto_obligatoria: boolean;
  plantilla_item_id: string | null;
  creado_offline: boolean;
  sincronizado_en: Date | null;
  activo: boolean;
  created_at: Date;
  updated_at: Date;
}

function aItem(fila: unknown): InventarioItem {
  const f = fila as FilaItem;
  return {
    id: f.id,
    zona_id: f.zona_id,
    nombre: f.nombre,
    field_type: f.field_type as InventarioItem['field_type'],
    opciones_json: Array.isArray(f.opciones_json) ? (f.opciones_json as string[]) : null,
    estado_checklist: f.estado_checklist,
    valor_respuesta:
      typeof f.valor_respuesta === 'object' && f.valor_respuesta !== null
        ? (f.valor_respuesta as Record<string, unknown>)
        : null,
    comentario: f.comentario,
    foto_obligatoria: f.foto_obligatoria,
    plantilla_item_id: f.plantilla_item_id,
    creado_offline: f.creado_offline,
    sincronizado_en: f.sincronizado_en ? f.sincronizado_en.toISOString() : null,
    activo: f.activo,
    created_at: f.created_at.toISOString(),
    updated_at: f.updated_at.toISOString(),
  };
}

interface FilaFoto {
  id: string;
  item_id: string;
  clave_storage: string;
  hash_sha256: string;
  autor: 'EMPLEADO' | 'INQUILINO';
  activo: boolean;
  created_at: Date;
}

function aFoto(fila: unknown): InventarioItemFoto {
  const f = fila as FilaFoto;
  return {
    id: f.id,
    item_id: f.item_id,
    clave_storage: f.clave_storage,
    hash_sha256: f.hash_sha256,
    autor: f.autor,
    activo: f.activo,
    created_at: f.created_at.toISOString(),
  };
}
