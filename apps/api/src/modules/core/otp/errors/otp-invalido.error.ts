import { AppError } from '../../../../common/errors/app.error';

/**
 * El código OTP es incorrecto o expiró (R5). Respuesta UNIFORME (401):
 * jamás se distingue el motivo (R12).
 */
export class OtpInvalidoError extends AppError {
  readonly code = 'OTP_INVALIDO';
  readonly httpStatus = 401;

  constructor(message = 'El código de verificación no es válido o expiró.') {
    super(message);
  }
}
