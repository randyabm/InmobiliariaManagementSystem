import { AppError } from '../../../../common/errors/app.error';

/**
 * El inquilino no verificó un OTP de FIRMA en la ventana reciente (R4,
 * RF-AU3): 401 sin distinguir el motivo (uniforme, R12 de #13).
 */
export class FirmaSinOtpError extends AppError {
  readonly code = 'FIRMA_SIN_OTP';
  readonly httpStatus = 401;

  constructor(message = 'Se requiere un código de verificación reciente para firmar.') {
    super(message);
  }
}
