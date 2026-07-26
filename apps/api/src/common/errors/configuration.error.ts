import { AppError } from './app.error';

/**
 * Falta configuración obligatoria o su valor es inválido (R17).
 *
 * La aplicación aborta el arranque en vez de continuar con un valor por
 * defecto inseguro. El mensaje nombra siempre la variable implicada para que
 * el error sea accionable, pero NUNCA incluye su valor (podría ser un secreto).
 */
export class ConfigurationError extends AppError {
  readonly code = 'CONFIGURATION_ERROR';
  readonly httpStatus = 500;

  /** Nombres de las variables de entorno que provocaron el error. */
  readonly variables: readonly string[];

  constructor(variables: readonly string[], detail?: string) {
    const listado = [...variables].join(', ');
    super(
      `Configuración inválida: revisa la(s) variable(s) de entorno ${listado}.` +
        (detail ? ` ${detail}` : ''),
    );
    this.variables = [...variables];
  }
}
