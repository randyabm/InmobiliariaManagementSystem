import { AppError } from '../../../../common/errors/app.error';

/**
 * La invitación no existe, expiró o ya fue usada (R3). Respuesta UNIFORME:
 * el consumidor no debe poder distinguir el motivo (R12).
 */
export class InvitacionInvalidaError extends AppError {
  readonly code = 'INVITACION_INVALIDA';
  readonly httpStatus = 401;

  constructor(message = 'La invitación no es válida o ya fue usada.') {
    super(message);
  }
}
