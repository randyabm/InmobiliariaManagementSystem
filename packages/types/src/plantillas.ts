/**
 * Contratos de las plantillas de inmuebles (feature #11, §8.8, RF-I2,
 * RF-I22, RF-I23).
 *
 * La plantilla es el MOLDE; el inventario (#12) la materializa como
 * snapshot. El catálogo base vive con `origen = 'SISTEMA'` en el tenant
 * reservado; el tenant clona y personaliza (`origen = 'TENANT'`).
 */

import type { TipoPropiedad } from './propiedades';

export const FIELD_TYPES = [
  'estado',
  'si_no',
  'si_no_estado',
  'conteo',
  'seleccion',
  'texto',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const ORIGENES_PLANTILLA = ['SISTEMA', 'TENANT'] as const;
export type OrigenPlantilla = (typeof ORIGENES_PLANTILLA)[number];

export interface PlantillaInmueble {
  readonly id: string;
  readonly tenant_id: string;
  readonly tipo: TipoPropiedad;
  readonly nombre: string;
  readonly origen: OrigenPlantilla;
  readonly version: number;
  readonly activo: boolean;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface PlantillaZona {
  readonly id: string;
  readonly plantilla_id: string;
  readonly nombre: string;
  readonly repetible: boolean;
  readonly obligatoria: boolean;
  readonly orden: number;
  readonly activo: boolean;
  readonly created_at: string;
}

export interface PlantillaItem {
  readonly id: string;
  readonly zona_id: string;
  readonly nombre: string;
  readonly field_type: FieldType;
  /** Solo con `field_type = 'seleccion'` (R9). */
  readonly opciones_json: readonly string[] | null;
  readonly obligatorio: boolean;
  readonly foto_obligatoria: boolean;
  readonly orden: number;
  readonly activo: boolean;
  readonly created_at: string;
}

/** Plantilla completa para `GET /plantillas/:id` (R10): zonas + ítems activos. */
export interface PlantillaCompleta extends PlantillaInmueble {
  readonly zonas: ReadonlyArray<PlantillaZona & { readonly items: readonly PlantillaItem[] }>;
}
