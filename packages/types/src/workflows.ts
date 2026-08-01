/**
 * Contratos del motor de workflows (feature #7, RF-W1..W5, RF-A4, D3).
 *
 * Todo el motor es **dirigido por datos**: estados, transiciones,
 * condiciones y responsables viven en filas; estos tipos describen la carga
 * útil HTTP y las columnas, sin lógica de máquina en el frontend.
 */

export const ORIGENES_DEFINICION = ['SISTEMA', 'TENANT'] as const;
export type OrigenDefinicion = (typeof ORIGENES_DEFINICION)[number];

export const TIPOS_EJECUCION = ['HUMANA', 'AUTOMATICA'] as const;
export type TipoEjecucion = (typeof TIPOS_EJECUCION)[number];

export const OPERADORES_CONDICION = [
  'igual',
  'distinto',
  'es_nulo',
  'no_nulo',
  'mayor_que',
  'menor_que',
] as const;
export type OperadorCondicion = (typeof OPERADORES_CONDICION)[number];

/**
 * Cláusula de condición (R3): `campo` es una ruta de puntos sobre el
 * `contexto` de la instancia. Se evalúa con un evaluador whitelisted, nunca
 * con `eval` ni SQL derivado.
 */
export interface CondicionClausula {
  readonly campo: string;
  readonly operador: OperadorCondicion;
  readonly valor?: unknown;
}

/** La condición de una transición es un array de cláusulas (vacío = siempre). */
export type Condicion = readonly CondicionClausula[];

/** El hook declarativo de notificaciones (frontera #10): dato, no ejecución. */
export interface NotificacionHook {
  readonly canal?: string;
  readonly plantilla?: string;
}

export interface WorkflowDefinicion {
  readonly id: string;
  readonly tenant_id: string;
  readonly nombre: string;
  readonly tipo: string;
  readonly origen: OrigenDefinicion;
  readonly version: number;
  readonly activo: boolean;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface WorkflowEstado {
  readonly id: string;
  readonly definicion_id: string;
  readonly clave: string;
  readonly etiqueta: string;
  readonly es_inicial: boolean;
  readonly es_final: boolean;
  readonly orden: number;
  readonly created_at: string;
}

export interface WorkflowTransicion {
  readonly id: string;
  readonly definicion_id: string;
  readonly origen_estado_id: string;
  readonly destino_estado_id: string;
  readonly clave: string;
  readonly tipo_ejecucion: TipoEjecucion;
  readonly roles_requeridos: readonly string[];
  readonly condicion: Condicion;
  readonly notificacion: NotificacionHook;
  readonly orden: number;
  readonly activo: boolean;
  readonly created_at: string;
}

/** Definición completa para `GET /workflows/:id`: estados + transiciones. */
export interface DefinicionCompleta extends WorkflowDefinicion {
  readonly estados: readonly WorkflowEstado[];
  readonly transiciones: readonly WorkflowTransicion[];
}

export interface WorkflowInstancia {
  readonly id: string;
  readonly tenant_id: string;
  readonly definicion_id: string;
  readonly entidad_tipo: string;
  readonly entidad_id: string;
  readonly estado_actual_id: string;
  readonly contexto: Readonly<Record<string, unknown>>;
  readonly activo: boolean;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface WorkflowTransicionLog {
  readonly id: string;
  readonly tenant_id: string;
  readonly instancia_id: string;
  readonly transicion_id: string | null;
  readonly desde_estado_id: string;
  readonly hacia_estado_id: string;
  readonly actor_id: string | null;
  readonly automatica: boolean;
  readonly contexto_tras: Readonly<Record<string, unknown>>;
  readonly created_at: string;
}

/** Respuesta de `GET /workflows/instancias/:id` (R9). */
export interface InstanciaConDisponibles {
  readonly instancia: WorkflowInstancia;
  readonly transiciones_disponibles: readonly WorkflowTransicion[];
}
