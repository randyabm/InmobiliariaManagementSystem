import { AppError } from '../../../../common/errors/app.error';

/**
 * El inventario no está en BORRADOR y no se puede invitar (R2): la
 * invitación se genera en la MISMA transacción que BORRADOR → ENVIADO.
 * 409 y nada cambia.
 */
export class InventarioNoEnviableError extends AppError {
  readonly code = 'INVENTARIO_NO_ENVIABLE';
  readonly httpStatus = 409;

  constructor(message = 'El inventario no está en borrador: no se puede invitar.') {
    super(message);
  }
}
