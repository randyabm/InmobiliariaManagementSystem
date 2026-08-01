/**
 * Contratos del motor de notificaciones (feature #10, RF-N1/N2, RF-W3).
 *
 * El disparo es el hook `notificacion` de las transiciones (#7): esta
 * feature lo consume a través del outbox transaccional y entrega por
 * proveedores tras una interfaz.
 */

export const CANALES_NOTIFICACION = ['CORREO', 'SMS', 'WHATSAPP', 'LLAMADA'] as const;
export type CanalNotificacion = (typeof CANALES_NOTIFICACION)[number];

export const ESTADOS_PENDIENTE = ['PENDIENTE', 'PROCESADA', 'FALLIDA'] as const;
export type EstadoPendiente = (typeof ESTADOS_PENDIENTE)[number];

export const ESTADOS_PROGRAMADA = ['PENDIENTE', 'EJECUTADA', 'CANCELADA'] as const;
export type EstadoProgramada = (typeof ESTADOS_PROGRAMADA)[number];

/**
 * El hook que #7 dejó como dato en `workflow_transicion.notificacion`,
 * ampliado con `destinatario` (R7, PA-10-3).
 *
 * - `destinatario.tipo: 'inquilino_actual' | 'propietario_principal'` se
 *   resuelve desde la entidad de la instancia al procesar.
 * - `destinatario.email` / `destinatario.celular` son directos.
 * - `canal` opcional: si falta, se usa el `medio_preferido_contacto` del
 *   perfil (RF-C4).
 */
export interface DestinatarioHook {
  readonly tipo?: 'inquilino_actual' | 'propietario_principal';
  readonly email?: string;
  readonly celular?: string;
}

export interface HookNotificacion {
  readonly canal?: CanalNotificacion;
  readonly plantilla?: string;
  readonly destinatario?: DestinatarioHook;
}

/** Fila del outbox (R1): la intención de notificar, escrita con la transición. */
export interface NotificacionPendiente {
  readonly id: string;
  readonly tenant_id: string;
  readonly canal: CanalNotificacion | null;
  readonly destinatario: string | null;
  readonly plantilla: string | null;
  readonly contenido: Readonly<Record<string, unknown>>;
  readonly entidad_tipo: string | null;
  readonly entidad_id: string | null;
  readonly transicion_id: string | null;
  readonly estado: EstadoPendiente;
  readonly intentos: number;
  readonly error: string | null;
  readonly created_at: string;
  readonly procesada_en: string | null;
}

/** Registro inmutable de lo entregado (R6). */
export interface NotificacionEnviada {
  readonly id: string;
  readonly tenant_id: string;
  readonly canal: CanalNotificacion;
  readonly destinatario: string;
  readonly entidad_tipo: string | null;
  readonly entidad_id: string | null;
  readonly plantilla: string | null;
  readonly contenido: Readonly<Record<string, unknown>>;
  readonly estado: EstadoPendiente;
  readonly created_at: string;
}

/** Recordatorio programado (R10). */
export interface NotificacionProgramada {
  readonly id: string;
  readonly tenant_id: string;
  readonly programada_para: string;
  readonly estado: EstadoProgramada;
  readonly destinatario: string;
  readonly canal: CanalNotificacion;
  readonly plantilla: string | null;
  readonly contenido: Readonly<Record<string, unknown>>;
  readonly entidad_tipo: string | null;
  readonly entidad_id: string | null;
  readonly created_at: string;
  readonly ejecutada_en: string | null;
}
