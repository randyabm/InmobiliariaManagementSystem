import { AppError } from '../../../../common/errors/app.error';

/** La plantilla base del tenant (o la copia de la propiedad) ya existe: 409. */
export class PlantillaContratoYaExisteError extends AppError {
  readonly code = 'PLANTILLA_CONTRATO_YA_EXISTE';
  readonly httpStatus = 409;

  constructor(message = 'La plantilla de contrato ya existe para este ámbito.') {
    super(message);
  }
}
