import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  FieldType,
  PlantillaCompleta,
  PlantillaInmueble,
  PlantillaItem,
  PlantillaZona,
  TipoPropiedad,
} from '@inmobiliaria/types';

import type { ContextoPeticion } from '../../../common/database/cliente-tenant';
import { ResourceNotFoundError } from '../../../common/errors';
import { PlantillaSistemaNoEditableError } from './errors/plantilla-sistema-no-editable.error';
import { PlantillasRepository } from './plantillas.repository';

/**
 * Plantillas de inmuebles (feature #11, RF-I22/RF-I23).
 *
 * - `clonar` (R5): copia zonas/ítems ACTIVOS de la plantilla (sistema o
 *   propia) a una copia TENANT; 409 si el tenant ya tiene el tipo.
 * - `exigirEditable` (R6): 404 si ajena/inexistente, 409 si SISTEMA.
 * - CRUD de zonas/ítems con validación de pertenencia (la zona cuelga de la
 *   plantilla de la ruta; el ítem de la zona) y de `opciones_json` (R9:
 *   solo con `seleccion` y no vacío).
 */
@Injectable()
export class PlantillasService {
  constructor(private readonly repositorio: PlantillasRepository) {}

  listar(ctx: ContextoPeticion): Promise<PlantillaInmueble[]> {
    return this.repositorio.listar(ctx);
  }

  async obtener(id: string, ctx: ContextoPeticion): Promise<PlantillaCompleta> {
    const plantilla = await this.repositorio.buscarCompleta(ctx, id);
    if (!plantilla || !plantilla.activo) {
      throw new ResourceNotFoundError();
    }
    return plantilla;
  }

  /**
   * PA-12-3 (feature #12) — la plantilla activa para un tipo de propiedad:
   * la copia TENANT si existe, si no la SISTEMA (mismo criterio PA-8-3).
   */
  async resolverPlantillaParaTenant(
    tipo: TipoPropiedad,
    ctx: ContextoPeticion,
  ): Promise<PlantillaInmueble | null> {
    const copia = await this.repositorio.buscarPlantillaPorTipo(ctx, tipo);
    if (copia) return copia;

    const { rows } = await ctx.cliente.query(
      `SELECT id, tenant_id::text AS tenant_id, tipo, nombre, origen, version,
              activo, created_at, updated_at
         FROM plantilla_inmueble
        WHERE tenant_id = '00000000-0000-0000-0000-000000000000'::uuid
          AND tipo = $1`,
      [tipo],
    );
    return rows[0] ? aPlantillaInmueblePublica(rows[0]) : null;
  }

  /** R5. */
  async clonar(id: string, ctx: ContextoPeticion): Promise<PlantillaInmueble> {
    const origen = await this.repositorio.buscarCompleta(ctx, id);
    if (!origen || !origen.activo) {
      throw new ResourceNotFoundError();
    }
    if (origen.tenant_id !== ctx.tenantId && origen.origen !== 'SISTEMA') {
      throw new ResourceNotFoundError();
    }

    const duplicado = await this.repositorio.buscarPlantillaPorTipo(ctx, origen.tipo);
    if (duplicado) {
      throw new PlantillaSistemaNoEditableError(
        `El tenant ya tiene una plantilla de tipo ${origen.tipo}.`,
      );
    }

    const { id: nuevaId } = await this.repositorio.insertarPlantilla(ctx.cliente, {
      tenantId: ctx.tenantId,
      tipo: origen.tipo,
      nombre: origen.nombre,
      origen: 'TENANT',
    });
    await this.repositorio.copiarPlantilla(ctx.cliente, origen.id, nuevaId);

    const creada = await this.repositorio.buscarCompleta(ctx, nuevaId);
    if (!creada) {
      throw new Error('La plantilla recién clonada no es legible.');
    }
    return creada;
  }

  /** R7 — CRUD de zonas. */
  async crearZona(
    plantillaId: string,
    datos: { nombre: string; repetible: boolean; obligatoria: boolean; orden: number },
    ctx: ContextoPeticion,
  ): Promise<PlantillaZona> {
    await this.exigirEditable(plantillaId, ctx);
    return this.repositorio.insertarZona(ctx, { plantillaId, ...datos });
  }

  async actualizarZona(
    plantillaId: string,
    idZona: string,
    datos: Partial<{ nombre: string; repetible: boolean; obligatoria: boolean; orden: number }>,
    ctx: ContextoPeticion,
  ): Promise<PlantillaZona> {
    await this.exigirEditable(plantillaId, ctx);
    const zona = await this.exigirZonaDePlantilla(idZona, plantillaId, ctx);
    const afectadas = await this.repositorio.actualizarZona(ctx, idZona, datos);
    if (afectadas === 0) {
      throw new ResourceNotFoundError();
    }
    return { ...zona, ...datos };
  }

  async darDeBajaZona(plantillaId: string, idZona: string, ctx: ContextoPeticion): Promise<void> {
    await this.exigirEditable(plantillaId, ctx);
    await this.exigirZonaDePlantilla(idZona, plantillaId, ctx);
    await this.repositorio.marcarZonaInactiva(ctx, idZona);
  }

  /** R8, R9 — CRUD de ítems. */
  async crearItem(
    zonaId: string,
    datos: {
      nombre: string;
      fieldType: FieldType;
      opcionesJson: string[] | null;
      obligatorio: boolean;
      fotoObligatoria: boolean;
      orden: number;
    },
    ctx: ContextoPeticion,
  ): Promise<PlantillaItem> {
    const zona = await this.exigirZonaActiva(zonaId, ctx);
    await this.exigirEditable(zona.plantilla_id, ctx);
    validarOpciones(datos.fieldType, datos.opcionesJson);
    return this.repositorio.insertarItem(ctx, { zonaId, ...datos });
  }

  async actualizarItem(
    idZona: string,
    idItem: string,
    datos: Partial<{
      nombre: string;
      fieldType: FieldType;
      opcionesJson: string[] | null;
      obligatorio: boolean;
      fotoObligatoria: boolean;
      orden: number;
    }>,
    ctx: ContextoPeticion,
  ): Promise<PlantillaItem> {
    const zona = await this.exigirZonaActiva(idZona, ctx);
    await this.exigirEditable(zona.plantilla_id, ctx);
    const item = await this.exigirItemDeZona(idItem, idZona, ctx);

    const fieldType = datos.fieldType ?? item.field_type;
    const opcionesJson: string[] | null =
      datos.opcionesJson !== undefined
        ? [...(datos.opcionesJson ?? [])]
        : item.opciones_json
          ? [...item.opciones_json]
          : null;
    validarOpciones(fieldType, opcionesJson);

    const afectadas = await this.repositorio.actualizarItem(ctx, idItem, {
      ...datos,
      ...(datos.opcionesJson !== undefined || datos.fieldType !== undefined
        ? { opcionesJson, fieldType }
        : {}),
    });
    if (afectadas === 0) {
      throw new ResourceNotFoundError();
    }
    return { ...item, ...datos };
  }

  async darDeBajaItem(idZona: string, idItem: string, ctx: ContextoPeticion): Promise<void> {
    const zona = await this.exigirZonaActiva(idZona, ctx);
    await this.exigirEditable(zona.plantilla_id, ctx);
    await this.exigirItemDeZona(idItem, idZona, ctx);
    await this.repositorio.marcarItemInactivo(ctx, idItem);
  }

  /** R6 — 404 si ajena/inexistente; 409 si es del sistema. */
  private async exigirEditable(plantillaId: string, ctx: ContextoPeticion): Promise<void> {
    const origen = await this.repositorio.origenDePlantilla(ctx, plantillaId);
    if (origen === null) {
      throw new ResourceNotFoundError();
    }
    if (origen === 'SISTEMA') {
      throw new PlantillaSistemaNoEditableError();
    }
  }

  private async exigirZonaDePlantilla(
    idZona: string,
    plantillaId: string,
    ctx: ContextoPeticion,
  ): Promise<PlantillaZona> {
    const zona = await this.repositorio.buscarZona(ctx, idZona);
    if (!zona || zona.plantilla_id !== plantillaId) {
      throw new ResourceNotFoundError();
    }
    return zona;
  }

  private async exigirZonaActiva(zonaId: string, ctx: ContextoPeticion): Promise<PlantillaZona> {
    const zona = await this.repositorio.buscarZona(ctx, zonaId);
    if (!zona || !zona.activo) {
      throw new ResourceNotFoundError();
    }
    return zona;
  }

  private async exigirItemDeZona(
    idItem: string,
    zonaId: string,
    ctx: ContextoPeticion,
  ): Promise<PlantillaItem> {
    const item = await this.repositorio.buscarItem(ctx, idItem);
    if (!item || item.zona_id !== zonaId) {
      throw new ResourceNotFoundError();
    }
    return item;
  }
}

/** Mapea una fila de plantilla_inmueble a su tipo público (PA-12-3). */
function aPlantillaInmueblePublica(fila: unknown): PlantillaInmueble {
  const f = fila as {
    id: string;
    tenant_id: string;
    tipo: TipoPropiedad;
    nombre: string;
    origen: 'SISTEMA' | 'TENANT';
    version: number;
    activo: boolean;
    created_at: Date;
    updated_at: Date;
  };
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

/** R9 — `opciones_json` solo con `seleccion` y no vacío (defensa; el borde valida con zod). */
function validarOpciones(fieldType: FieldType, opcionesJson: string[] | null): void {
  if (fieldType === 'seleccion') {
    if (!opcionesJson || opcionesJson.length === 0) {
      throw new BadRequestException('Un ítem de selección debe declarar opciones_json.');
    }
    return;
  }
  if (opcionesJson !== null) {
    throw new BadRequestException(
      'opciones_json solo se admite con field_type = seleccion.',
    );
  }
}
