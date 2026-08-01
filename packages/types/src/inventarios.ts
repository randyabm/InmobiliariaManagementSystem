/**
 * Contratos del inventario (feature #12, §8.7, RF-I1/I3/I7/I24).
 *
 * El inventario es la INSTANCIA materializada de la plantilla (#11):
 * `plantilla_zona_id`/`plantilla_item_id` guardan el origen del snapshot,
 * pero el contenido es independiente (RF-I24).
 */

import type { FieldType } from './plantillas';

export const TIPOS_EVENTO_INVENTARIO = ['ENTREGA', 'DEVOLUCION'] as const;
export type TipoEventoInventario = (typeof TIPOS_EVENTO_INVENTARIO)[number];

export const ESTADOS_INVENTARIO = [
  'BORRADOR',
  'ENVIADO',
  'EN_REVISION',
  'EN_NEGOCIACION',
  'ACORDADO',
  'FIRMADO',
  'CERRADO',
] as const;
export type EstadoInventario = (typeof ESTADOS_INVENTARIO)[number];

export const ESTADOS_CHECKLIST = ['BUENO', 'REGULAR', 'MALO'] as const;
export type EstadoChecklist = (typeof ESTADOS_CHECKLIST)[number];

export const AUTORES_FOTO = ['EMPLEADO', 'INQUILINO'] as const;
export type AutorFoto = (typeof AUTORES_FOTO)[number];

export interface Inventario {
  readonly id: string;
  readonly tenant_id: string;
  readonly propiedad_id: string;
  readonly tipo_evento: TipoEventoInventario;
  readonly estado: EstadoInventario;
  readonly creado_por: string | null;
  readonly revision_completada_en: string | null;
  readonly activo: boolean;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface InventarioZona {
  readonly id: string;
  readonly inventario_id: string;
  readonly nombre: string;
  readonly repetible: boolean;
  readonly orden: number;
  readonly plantilla_zona_id: string | null;
  readonly activo: boolean;
  readonly created_at: string;
}

export interface InventarioItem {
  readonly id: string;
  readonly zona_id: string;
  readonly nombre: string;
  readonly field_type: FieldType;
  readonly opciones_json: readonly string[] | null;
  readonly estado_checklist: EstadoChecklist | null;
  readonly valor_respuesta: Readonly<Record<string, unknown>> | null;
  readonly comentario: string | null;
  readonly foto_obligatoria: boolean;
  readonly plantilla_item_id: string | null;
  readonly creado_offline: boolean;
  readonly sincronizado_en: string | null;
  readonly activo: boolean;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface InventarioItemFoto {
  readonly id: string;
  readonly item_id: string;
  readonly clave_storage: string;
  readonly hash_sha256: string;
  readonly autor: AutorFoto;
  readonly activo: boolean;
  readonly created_at: string;
}

/** Ficha completa de `GET /inventarios/:id` (R7). */
export interface InventarioCompleto extends Inventario {
  readonly zonas: ReadonlyArray<
    InventarioZona & {
      readonly items: ReadonlyArray<
        InventarioItem & { readonly fotos: readonly InventarioItemFoto[] }
      >;
    }
  >;
}
