import { AppError } from '../../../../common/errors';

/**
 * El `codigo` de inmobiliaria falta o no cumple el formato de **R73**
 * (**R63**, D-12).
 *
 * ## Por qué esto es 400 y no 401
 *
 * Es la única distinción que el login hace, y la frontera está elegida con
 * cuidado (`design.md` §20.2):
 *
 * - **400** — error de **forma**: no vino el código, o lo que vino no puede ser
 *   un código de inmobiliaria (mayúsculas, tildes, más de 63 caracteres…). No
 *   revela absolutamente nada, porque la respuesta es la misma se llame como se
 *   llame la inmobiliaria: depende solo de lo que el cliente escribió.
 * - **401** — todo lo demás, incluido *"ese código no existe"*. Si un código
 *   inexistente diera un error distinto del de unas credenciales inválidas, el
 *   formulario de acceso se convertiría en un oráculo para averiguar **qué
 *   inmobiliarias son clientes del SaaS** (**R64**).
 */
export class CodigoDeInmobiliariaInvalidoError extends AppError {
  readonly code = 'CODIGO_DE_INMOBILIARIA_INVALIDO';
  readonly httpStatus = 400;

  constructor(
    message = 'Debes indicar el código de la inmobiliaria y debe tener un formato válido.',
  ) {
    super(message);
  }
}
