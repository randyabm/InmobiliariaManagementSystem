import { AppError } from '../../../../common/errors';

/**
 * Al deduplicar por documento, el nombre declarado no coincide con el de la
 * identidad ya registrada en esa inmobiliaria (**R9**, **R28**, **R27**).
 *
 * ## Por qué es un 409 y no un *first-write-wins* silencioso
 *
 * **Decisión del humano (PA-1, 2026-08-01).** Dos nombres distintos bajo el
 * mismo documento significan que **una de las dos fichas está mal**. Seguir
 * adelante en silencio consolidaría el error en una identidad que a partir de
 * ese momento comparten dos roles, y nadie volvería a mirarla.
 *
 * ## Por qué este error sí lleva datos, y cuáles
 *
 * Es el **único** error de la feature #26 que devuelve algo además del código,
 * y es deliberado: interrumpe el "crear en línea" de RF-C6, así que tiene que
 * decir **qué ficha corregir y contra qué nombre choca**. Con `user_id`,
 * `nombre_registrado` y `nombre_recibido` el empleado resuelve con un `PATCH`
 * al perfil existente y reintenta, sin salir a buscar nada.
 *
 * Los tres datos son de **la misma inmobiliaria** —el documento nunca se busca
 * fuera (R10, R14)—, así que el cuerpo no revela nada ajeno.
 *
 * **El documento NO aparece**: ni en el cuerpo, ni en el mensaje, ni en los
 * logs (`docs/conventions.md`, Ley 1581 de 2012). Quien recibe este error
 * acaba de teclearlo; repetírselo solo añade PII a los registros.
 */
export class NombreNoCoincideConIdentidadError extends AppError {
  readonly code = 'NOMBRE_NO_COINCIDE_CON_IDENTIDAD';
  readonly httpStatus = 409;

  constructor(
    readonly userId: string,
    readonly nombreRegistrado: string,
    readonly nombreRecibido: string,
  ) {
    super(
      'Ya existe una persona con ese documento en esta inmobiliaria, ' +
        'registrada con otro nombre. Corrija la ficha existente antes de continuar.',
    );
  }

  /**
   * Campos que el borde HTTP añade al cuerpo del error (**R28**).
   *
   * Se expone como datos y no como texto interpolado en el mensaje para que el
   * cliente pueda usarlos sin parsear prosa.
   */
  get detalles(): Readonly<Record<string, unknown>> {
    return {
      user_id: this.userId,
      nombre_registrado: this.nombreRegistrado,
      nombre_recibido: this.nombreRecibido,
    };
  }
}
