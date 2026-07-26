/**
 * Raíz de todos los errores de dominio del sistema.
 *
 * docs/conventions.md ("Manejo de errores"): nunca se devuelve un 500 genérico
 * por una condición esperada. Cada condición esperada tiene una subclase con
 * significado y el borde HTTP la traduce a un código de estado.
 */
export abstract class AppError extends Error {
  /** Código estable, legible por máquina, en `SCREAMING_SNAKE_CASE`. */
  abstract readonly code: string;

  /** Código HTTP con el que el borde debe responder. */
  abstract readonly httpStatus: number;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
