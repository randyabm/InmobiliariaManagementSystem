/**
 * Contratos del ciclo de vida de la propiedad (feature #8, RF-P4/P5).
 *
 * El estado NO vive en `propiedad` (PA-8-1): se lee de la instancia del
 * motor de workflows (#7). Estos tipos describen lo que la ficha y el
 * dashboard exponen.
 */

import type { WorkflowInstancia, WorkflowTransicion } from './workflows';

/** Estado del ciclo de vida leído del motor (R3, R4). */
export interface EstadoCicloVida {
  readonly clave: string;
  readonly etiqueta: string;
  /** Momento de la última transición (`updated_at` de la instancia). */
  readonly desde: string;
}

/** Respuesta de `GET /propiedades/:id/ciclo-vida` (R4). */
export interface CicloVidaDePropiedad {
  readonly estado: EstadoCicloVida;
  readonly transiciones_disponibles: readonly WorkflowTransicion[];
}

/** Fila del dashboard (R9, R11, R12). */
export interface DashboardFila {
  readonly id: string;
  readonly direccion: string;
  readonly tipo: string;
  readonly canon: string;
  readonly estado_ciclo_vida: EstadoCicloVida | null;
  readonly instancia_id: string | null;
  readonly tiempo_en_estado_segundos: number;
}

/** Respuesta de `GET /propiedades/dashboard` (R9). */
export interface DashboardPropiedades {
  readonly conteos: ReadonlyArray<{
    readonly clave: string;
    readonly etiqueta: string;
    readonly cantidad: number;
  }>;
  readonly propiedades: readonly DashboardFila[];
}

/** La instancia interna del motor, expuesta para la ejecución (R12). */
export type InstanciaDeCicloVida = WorkflowInstancia;
