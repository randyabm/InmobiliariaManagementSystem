import { AppError } from '../../../../common/errors/app.error';

/**
 * El inventario no está en condiciones de firmarse (R5): no está en
 * ACORDADO, ya está firmado/cerrado, o el documento no coincide con el
 * que se está firmando. 409 sin cambios.
 */
export class DocumentoNoFirmableError extends AppError {
  readonly code = 'DOCUMENTO_NO_FIRMABLE';
  readonly httpStatus = 409;

  constructor(message = 'El documento no se puede firmar en este estado.') {
    super(message);
  }
}
