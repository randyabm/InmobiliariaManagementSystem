import { AppError } from './app.error';

/**
 * El recurso solicitado no existe *o no es visible para quien lo pide*.
 *
 * docs/conventions.md: un recurso que pertenece a otro tenant devuelve 404, no
 * 403 — no se confirma la existencia de recursos ajenos. Las features #2 y #3
 * reutilizan este error para ese caso en vez de inventar otro.
 */
export class ResourceNotFoundError extends AppError {
  readonly code = 'RESOURCE_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(message = 'El recurso solicitado no existe.') {
    super(message);
  }
}
