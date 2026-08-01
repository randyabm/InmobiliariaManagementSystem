import { AppError } from '../../../../common/errors/app.error';

/** Merge fields inválidos (PA-16-2): `{campo}` del cuerpo sin definición. */
export class PlantillaContratoInvalidaError extends AppError {
  readonly code = 'PLANTILLA_CONTRATO_INVALIDA';
  readonly httpStatus = 400;

  constructor(message = 'La plantilla de contrato no es válida.') {
    super(message);
  }
}
