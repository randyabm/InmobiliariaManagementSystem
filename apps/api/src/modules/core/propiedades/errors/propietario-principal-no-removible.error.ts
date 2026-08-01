import { AppError } from '../../../../common/errors';

/**
 * No se puede remover (ni duplicar) el propietario principal de la propiedad
 * (**R10**).
 *
 * El principal es contra quien se resuelve la cuenta de giro (R8): dejarlo
 * sin principal haría irresoluble el giro del canon, y duplicarlo como
 * adicional sería un estado contradictorio. Cambiar de principal es una
 * decisión de la ficha (`PATCH /propiedades/:id`), no de la puente.
 */
export class PropietarioPrincipalNoRemovibleError extends AppError {
  readonly code = 'PROPIETARIO_PRINCIPAL_NO_REMOVIBLE';
  readonly httpStatus = 409;

  constructor(
    message = 'El propietario principal de la propiedad no puede removerse.',
  ) {
    super(message);
  }
}
