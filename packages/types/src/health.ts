/**
 * Contrato del healthcheck, compartido entre `apps/api` (lo produce) y
 * `apps/web` (lo consume). Vive aqui para que ningun lado duplique la forma
 * de la respuesta (docs/conventions.md, "TypeScript").
 */

/** Ruta publica del healthcheck de liveness. */
export const HEALTH_ENDPOINT = '/health';

/**
 * Respuesta de `GET /health`.
 *
 * INVARIANTE DE SEGURIDAD (R15): estas son las UNICAS claves permitidas. No
 * se anaden variables de entorno, cadenas de conexion, identificadores de
 * tenant ni versiones de dependencias de infraestructura.
 */
export interface HealthStatus {
  /** Siempre `ok`: es una sonda de liveness, no de dependencias. */
  readonly status: 'ok';
  /** Version de la aplicacion (`version` del package.json de apps/api). */
  readonly version: string;
  /** Segundos transcurridos desde el arranque del proceso. */
  readonly uptime: number;
}
