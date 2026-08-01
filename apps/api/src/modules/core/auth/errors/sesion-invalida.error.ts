import { AppError } from '../../../../common/errors';

/**
 * Sesión inválida o inexistente (**R4**, **R5**, **R9**).
 *
 * ## Un solo cuerpo para todos los fallos
 *
 * Sesión inexistente, revocada, expirada, versión desactualizada, token sin
 * `jti`/`ver` o refresh que no casa: todos responden **exactamente igual**.
 * Distinguir cuál ocurrió en la respuesta convertiría el endpoint en un
 * oráculo de estado de las sesiones — un atacante podría enumerar qué
 * sesiones están vivas, cuáles se revocaron y cuándo.
 *
 * Es 401 (autenticación), no 403: el token no está "mal autorizado", está
 * caducado en vida. La revocación produce el mismo 401 que la expiración
 * natural, que es el comportamiento que el cliente ya sabe manejar.
 */
export class SesionInvalidaError extends AppError {
  readonly code = 'SESION_INVALIDA';
  readonly httpStatus = 401;

  constructor(message = 'La sesión ya no es válida. Vuelve a iniciar sesión.') {
    super(message);
  }
}
