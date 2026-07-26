import { AppError } from './app.error';

/**
 * El tenant pedido en `x-tenant-id` no corresponde a ningún rol activo del
 * JWT, o la petición no permite resolver un tenant sin ambigüedad (R33).
 *
 * Es 403 y no 404 a propósito: el recurso en disputa no es una fila de negocio
 * sino la propia inmobiliaria, cuya existencia el portador del token ya conoce
 * o no puede deducir del mensaje. No se nombra el tenant en el mensaje.
 */
export class TenantNoAutorizadoError extends AppError {
  readonly code = 'TENANT_NO_AUTORIZADO';
  readonly httpStatus = 403;

  constructor(
    message = 'No tienes acceso a la inmobiliaria indicada en la petición.',
  ) {
    super(message);
  }
}
