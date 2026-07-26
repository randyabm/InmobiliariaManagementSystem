/**
 * Forma unica de los errores HTTP de la API.
 *
 * Los mensajes van SIEMPRE en espanol y NUNCA incluyen stack traces, SQL ni
 * datos de otro tenant (docs/conventions.md, "Manejo de errores").
 */
export interface ApiErrorResponse {
  /** Codigo HTTP. */
  readonly statusCode: number;
  /** Codigo estable y legible por maquina, en `SCREAMING_SNAKE_CASE`. */
  readonly error: string;
  /** Mensaje accionable para la persona usuaria, en espanol. */
  readonly message: string;
  /** Instante del error en ISO-8601 con zona horaria. */
  readonly timestamp: string;
  /** Ruta solicitada. */
  readonly path: string;
}
