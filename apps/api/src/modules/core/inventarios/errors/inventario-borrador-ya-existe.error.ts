import { AppError } from '../../../../common/errors/app.error';

/**
 * Ya existe un borrador para la misma propiedad y tipo de evento
 * (PA-12-2, R1 del spec de #12): un solo borrador simultáneo por par.
 */
export class InventarioBorradorYaExisteError extends AppError {
  readonly code = 'INVENTARIO_BORRADOR_YA_EXISTE';
  readonly httpStatus = 409;

  constructor(message = 'Ya existe un borrador para esta propiedad y tipo de evento.') {
    super(message);
  }
}
