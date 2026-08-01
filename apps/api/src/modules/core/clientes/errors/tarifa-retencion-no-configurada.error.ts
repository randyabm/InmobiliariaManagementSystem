import { AppError } from '../../../../common/errors';

/**
 * El tenant no ha configurado la tarifa de retención para el año solicitado
 * (**R9**, **D-2**).
 *
 * ## Por qué es un error y no un valor por defecto
 *
 * La tarifa la fija la ley y cambia por año (D-2). Asumir un porcentaje
 * silencioso produciría un cálculo de retención incorrecto y, con él, giros
 * al propietario con retención mal calculada. Fallar explícito es la única
 * opción segura: el admin configura el año (R6) y se reintenta.
 *
 * Es 409 porque la petición es correcta pero el **estado** del tenant no
 * permite cumplirla — el análogo fiscal de `CODEUDOR_YA_EXISTE` (R14).
 *
 * El mensaje no menciona el año ni el tenant en concreto: no hay datos
 * personales aquí, pero el año ya está en la ruta que provocó el error.
 */
export class TarifaRetencionNoConfiguradaError extends AppError {
  readonly code = 'TARIFA_RETENCION_NO_CONFIGURADA';
  readonly httpStatus = 409;

  constructor(
    message = 'Este año aún no tiene tarifa de retención configurada para la inmobiliaria.',
  ) {
    super(message);
  }
}
