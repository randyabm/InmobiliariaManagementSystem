import { AppError } from '../../../../common/errors/app.error';

/**
 * La revisión no cumple las reglas de dominio (R6): objetar sin comentario.
 * 400 y nada se escribe.
 */
export class RevisionInvalidaError extends AppError {
  readonly code = 'REVISION_INVALIDA';
  readonly httpStatus = 400;

  constructor(message = 'La revisión no cumple las reglas del inventario.') {
    super(message);
  }
}
