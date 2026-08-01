import { AppError } from '../../../../common/errors/app.error';

/**
 * El inventario no tiene la revisión completa: no se puede confirmar el
 * acuerdo (R6). 409 y nada cambia.
 */
export class AcuerdoIncompletoError extends AppError {
  readonly code = 'ACUERDO_INCOMPLETO';
  readonly httpStatus = 409;

  constructor(message = 'La revisión del inquilino no está completa.') {
    super(message);
  }
}
