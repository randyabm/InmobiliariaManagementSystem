import { AppError } from '../../../../common/errors';

/**
 * R7 — el destinatario o el canal no se pueden resolver.
 *
 * Es un error INTERNO del procesador: se traduce a `FALLIDA` en la fila del
 * outbox, nunca a una respuesta HTTP (el envío no condiciona la transición,
 * R18). El mensaje no lleva el contenido ni el destinatario (R15).
 */
export class NotificacionNoResolubleError extends AppError {
  readonly code = 'NOTIFICACION_NO_RESOLUBLE';
  readonly httpStatus = 500;

  constructor(message = 'No se pudo resolver el destinatario de la notificación.') {
    super(message);
  }
}
