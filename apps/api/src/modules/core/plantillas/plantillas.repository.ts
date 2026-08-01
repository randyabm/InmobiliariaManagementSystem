import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type {
  FieldType,
  PlantillaCompleta,
  PlantillaInmueble,
  PlantillaItem,
  PlantillaZona,
  TipoPropiedad,
} from '@inmobiliaria/types';

import type { ContextoPeticion } from '../../../common/database/cliente-tenant';

/**
 * Único punto de acceso a las tres tablas de plantillas (feature #11).
 *
 * Mismas reglas que el resto del proyecto: solo el `PoolClient` de la
 * transacción con `SET LOCAL app.current_tenant` (R12) y la visibilidad del
 * catálogo del sistema la da la política RLS (PA-11-1) sin código especial.
 */
@Injectable()
export class PlantillasRepository {
  private static readonly SELECT_PLANTILLA = `
    SELECT id, tenant_id::text AS tenant_id, tipo, nombre, origen, version,
           activo, created_at, updated_at
      FROM plantilla_inmueble`;

  private static readonly SELECT_ZONA = `
    SELECT id, plantilla_id, nombre, repetible, obligatoria, orden, activo,
           created_at
      FROM plantilla_zona`;

  private static readonly SELECT_ITEM = `
    SELECT id, zona_id, nombre, field_type, opciones_json, obligatorio,
           foto_obligatoria, orden, activo, created_at
      FROM plantilla_item`;

  async listar(ctx: ContextoPeticion): Promise<PlantillaInmueble[]> {
    const { rows } = await ctx.cliente.query(
      `${PlantillasRepository.SELECT_PLANTILLA} ORDER BY tipo, origen`,
    );
    return rows.map(aPlantilla);
  }

  async buscarCompleta(
    ctx: ContextoPeticion,
    id: string,
  ): Promise<PlantillaCompleta | null> {
    const { rows } = await ctx.cliente.query(
      `${PlantillasRepository.SELECT_PLANTILLA} WHERE id = $1`,
      [id],
    );
    if (!rows[0]) return null;
    const plantilla = aPlantilla(rows[0]);

    const zonas = await this.zonasActivas(ctx.cliente, id);
    const itemsPorZona = await Promise.all(
      zonas.map(async (zona) => ({
        ...zona,
        items: await this.itemsActivos(ctx.cliente, zona.id),
      })),
    );

    return { ...plantilla, zonas: itemsPorZona };
  }

  async zonasActivas(cliente: PoolClient, plantillaId: string): Promise<PlantillaZona[]> {
    const { rows } = await cliente.query(
      `${PlantillasRepository.SELECT_ZONA}
        WHERE plantilla_id = $1 AND activo = true ORDER BY orden`,
      [plantillaId],
    );
    return rows.map(aZona);
  }

  async itemsActivos(cliente: PoolClient, zonaId: string): Promise<PlantillaItem[]> {
    const { rows } = await cliente.query(
      `${PlantillasRepository.SELECT_ITEM}
        WHERE zona_id = $1 AND activo = true ORDER BY orden`,
      [zonaId],
    );
    return rows.map(aItem);
  }

  async insertarPlantilla(
    cliente: PoolClient,
    datos: { tenantId: string; tipo: TipoPropiedad; nombre: string; origen: 'SISTEMA' | 'TENANT' },
  ): Promise<{ id: string }> {
    const { rows } = await cliente.query<{ id: string }>(
      `INSERT INTO plantilla_inmueble (tenant_id, tipo, nombre, origen)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [datos.tenantId, datos.tipo, datos.nombre, datos.origen],
    );
    return { id: rows[0]!.id };
  }

  /** R5 — clon: zonas e ítems ACTIVOS de la origen a la copia. */
  async copiarPlantilla(
    cliente: PoolClient,
    origenId: string,
    nuevaPlantillaId: string,
  ): Promise<void> {
    await cliente.query(
      `INSERT INTO plantilla_zona
         (plantilla_id, nombre, repetible, obligatoria, orden, activo)
       SELECT $1, nombre, repetible, obligatoria, orden, activo
         FROM plantilla_zona WHERE plantilla_id = $2 AND activo = true`,
      [nuevaPlantillaId, origenId],
    );
    await cliente.query(
      `INSERT INTO plantilla_item
         (zona_id, nombre, field_type, opciones_json, obligatorio,
          foto_obligatoria, orden, activo)
       SELECT zn.id, i.nombre, i.field_type, i.opciones_json, i.obligatorio,
              i.foto_obligatoria, i.orden, i.activo
         FROM plantilla_item i
         JOIN plantilla_zona zo ON zo.id = i.zona_id
         JOIN plantilla_zona zn
           ON zn.plantilla_id = $1 AND zn.nombre = zo.nombre
        WHERE zo.plantilla_id = $2 AND zo.activo = true AND i.activo = true`,
      [nuevaPlantillaId, origenId],
    );
  }

  async buscarPlantillaPorTipo(
    ctx: ContextoPeticion,
    tipo: TipoPropiedad,
  ): Promise<PlantillaInmueble | null> {
    const { rows } = await ctx.cliente.query(
      `${PlantillasRepository.SELECT_PLANTILLA} WHERE tenant_id = $1 AND tipo = $2`,
      [ctx.tenantId, tipo],
    );
    return rows[0] ? aPlantilla(rows[0]) : null;
  }

  async origenDePlantilla(
    ctx: ContextoPeticion,
    id: string,
  ): Promise<'SISTEMA' | 'TENANT' | null> {
    const { rows } = await ctx.cliente.query<{ origen: 'SISTEMA' | 'TENANT' }>(
      'SELECT origen FROM plantilla_inmueble WHERE id = $1',
      [id],
    );
    return rows[0]?.origen ?? null;
  }

  async buscarZona(ctx: ContextoPeticion, id: string): Promise<PlantillaZona | null> {
    const { rows } = await ctx.cliente.query(
      `${PlantillasRepository.SELECT_ZONA} WHERE id = $1`,
      [id],
    );
    return rows[0] ? aZona(rows[0]) : null;
  }

  async insertarZona(
    ctx: ContextoPeticion,
    datos: {
      plantillaId: string;
      nombre: string;
      repetible: boolean;
      obligatoria: boolean;
      orden: number;
    },
  ): Promise<PlantillaZona> {
    const { rows } = await ctx.cliente.query(
      `${PlantillasRepository.SELECT_ZONA_INSERT_RETURNING}`,
      [datos.plantillaId, datos.nombre, datos.repetible, datos.obligatoria, datos.orden],
    );
    return aZona(rows[0]!);
  }

  private static readonly SELECT_ZONA_INSERT_RETURNING = `
    INSERT INTO plantilla_zona
      (plantilla_id, nombre, repetible, obligatoria, orden)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id, plantilla_id, nombre, repetible, obligatoria, orden, activo,
              created_at`;

  async actualizarZona(
    ctx: ContextoPeticion,
    id: string,
    cambios: Partial<{ nombre: string; repetible: boolean; obligatoria: boolean; orden: number }>,
  ): Promise<number> {
    const asignaciones: string[] = [];
    const valores: unknown[] = [];
    if (cambios.nombre !== undefined) {
      valores.push(cambios.nombre);
      asignaciones.push(`nombre = $${valores.length}`);
    }
    if (cambios.repetible !== undefined) {
      valores.push(cambios.repetible);
      asignaciones.push(`repetible = $${valores.length}`);
    }
    if (cambios.obligatoria !== undefined) {
      valores.push(cambios.obligatoria);
      asignaciones.push(`obligatoria = $${valores.length}`);
    }
    if (cambios.orden !== undefined) {
      valores.push(cambios.orden);
      asignaciones.push(`orden = $${valores.length}`);
    }
    if (asignaciones.length === 0) return 0;
    valores.push(id);

    const { rowCount } = await ctx.cliente.query(
      `UPDATE plantilla_zona SET ${asignaciones.join(', ')} WHERE id = $${valores.length}`,
      valores,
    );
    return rowCount ?? 0;
  }

  async marcarZonaInactiva(ctx: ContextoPeticion, id: string): Promise<number> {
    const { rowCount } = await ctx.cliente.query(
      `UPDATE plantilla_zona SET activo = false WHERE id = $1`,
      [id],
    );
    return rowCount ?? 0;
  }

  async buscarItem(ctx: ContextoPeticion, id: string): Promise<PlantillaItem | null> {
    const { rows } = await ctx.cliente.query(
      `${PlantillasRepository.SELECT_ITEM} WHERE id = $1`,
      [id],
    );
    return rows[0] ? aItem(rows[0]) : null;
  }

  async insertarItem(
    ctx: ContextoPeticion,
    datos: {
      zonaId: string;
      nombre: string;
      fieldType: FieldType;
      opcionesJson: string[] | null;
      obligatorio: boolean;
      fotoObligatoria: boolean;
      orden: number;
    },
  ): Promise<PlantillaItem> {
    const { rows } = await ctx.cliente.query(
      `${PlantillasRepository.SELECT_ITEM_INSERT_RETURNING}`,
      [
        datos.zonaId,
        datos.nombre,
        datos.fieldType,
        datos.opcionesJson ? JSON.stringify(datos.opcionesJson) : null,
        datos.obligatorio,
        datos.fotoObligatoria,
        datos.orden,
      ],
    );
    return aItem(rows[0]!);
  }

  private static readonly SELECT_ITEM_INSERT_RETURNING = `
    INSERT INTO plantilla_item
      (zona_id, nombre, field_type, opciones_json, obligatorio,
       foto_obligatoria, orden)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id, zona_id, nombre, field_type, opciones_json, obligatorio,
              foto_obligatoria, orden, activo, created_at`;

  async actualizarItem(
    ctx: ContextoPeticion,
    id: string,
    cambios: Partial<{
      nombre: string;
      fieldType: FieldType;
      opcionesJson: string[] | null;
      obligatorio: boolean;
      fotoObligatoria: boolean;
      orden: number;
    }>,
  ): Promise<number> {
    const asignaciones: string[] = [];
    const valores: unknown[] = [];
    if (cambios.nombre !== undefined) {
      valores.push(cambios.nombre);
      asignaciones.push(`nombre = $${valores.length}`);
    }
    if (cambios.fieldType !== undefined) {
      valores.push(cambios.fieldType);
      asignaciones.push(`field_type = $${valores.length}`);
    }
    if (cambios.opcionesJson !== undefined) {
      valores.push(cambios.opcionesJson ? JSON.stringify(cambios.opcionesJson) : null);
      asignaciones.push(`opciones_json = $${valores.length}`);
    }
    if (cambios.obligatorio !== undefined) {
      valores.push(cambios.obligatorio);
      asignaciones.push(`obligatorio = $${valores.length}`);
    }
    if (cambios.fotoObligatoria !== undefined) {
      valores.push(cambios.fotoObligatoria);
      asignaciones.push(`foto_obligatoria = $${valores.length}`);
    }
    if (cambios.orden !== undefined) {
      valores.push(cambios.orden);
      asignaciones.push(`orden = $${valores.length}`);
    }
    if (asignaciones.length === 0) return 0;
    valores.push(id);

    const { rowCount } = await ctx.cliente.query(
      `UPDATE plantilla_item SET ${asignaciones.join(', ')} WHERE id = $${valores.length}`,
      valores,
    );
    return rowCount ?? 0;
  }

  async marcarItemInactivo(ctx: ContextoPeticion, id: string): Promise<number> {
    const { rowCount } = await ctx.cliente.query(
      `UPDATE plantilla_item SET activo = false WHERE id = $1`,
      [id],
    );
    return rowCount ?? 0;
  }
}

interface FilaPlantilla {
  id: string;
  tenant_id: string;
  tipo: TipoPropiedad;
  nombre: string;
  origen: 'SISTEMA' | 'TENANT';
  version: number;
  activo: boolean;
  created_at: Date;
  updated_at: Date;
}

function aPlantilla(fila: unknown): PlantillaInmueble {
  const f = fila as FilaPlantilla;
  return {
    id: f.id,
    tenant_id: f.tenant_id,
    tipo: f.tipo,
    nombre: f.nombre,
    origen: f.origen,
    version: f.version,
    activo: f.activo,
    created_at: f.created_at.toISOString(),
    updated_at: f.updated_at.toISOString(),
  };
}

interface FilaZona {
  id: string;
  plantilla_id: string;
  nombre: string;
  repetible: boolean;
  obligatoria: boolean;
  orden: number;
  activo: boolean;
  created_at: Date;
}

function aZona(fila: unknown): PlantillaZona {
  const f = fila as FilaZona;
  return {
    id: f.id,
    plantilla_id: f.plantilla_id,
    nombre: f.nombre,
    repetible: f.repetible,
    obligatoria: f.obligatoria,
    orden: f.orden,
    activo: f.activo,
    created_at: f.created_at.toISOString(),
  };
}

interface FilaItem {
  id: string;
  zona_id: string;
  nombre: string;
  field_type: FieldType;
  opciones_json: unknown;
  obligatorio: boolean;
  foto_obligatoria: boolean;
  orden: number;
  activo: boolean;
  created_at: Date;
}

function aItem(fila: unknown): PlantillaItem {
  const f = fila as FilaItem;
  return {
    id: f.id,
    zona_id: f.zona_id,
    nombre: f.nombre,
    field_type: f.field_type,
    opciones_json: Array.isArray(f.opciones_json)
      ? (f.opciones_json as string[])
      : null,
    obligatorio: f.obligatorio,
    foto_obligatoria: f.foto_obligatoria,
    orden: f.orden,
    activo: f.activo,
    created_at: f.created_at.toISOString(),
  };
}
