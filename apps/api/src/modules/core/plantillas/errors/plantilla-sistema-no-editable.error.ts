import { AppError } from '../../../../common/errors';

/**
 * R6 — las plantillas del sistema son de solo lectura por API (RF-I22).
 */
export class PlantillaSistemaNoEditableError extends AppError {
  readonly code = 'PLANTILLA_SISTEMA_NO_EDITABLE';
  readonly httpStatus = 409;

  constructor(message = 'La plantilla del sistema no puede editarse.') {
    super(message);
  }
}
