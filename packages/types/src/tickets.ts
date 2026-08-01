/**
 * Contratos de tickets de mantenimiento (feature #31, §6.5).
 * Los tickets son instancias del motor de workflows (#7): la definición
 * `incidencias` se siembra por migración (PA-31-1).
 */

export interface TicketResumen {
  readonly id: string;
  readonly propiedad_id: string;
  readonly categoria: string;
  readonly descripcion: string;
  readonly estado: string;
  readonly solicitante_user_id: string;
  readonly costo_aprobado: boolean | null;
  readonly created_at: string;
}
