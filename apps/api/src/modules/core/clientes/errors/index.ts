import { AppError } from '../../../../common/errors';

/**
 * El (tipo_documento, documento) ya tiene perfil en el tenant de la petición
 * (**R24**, **D-4**).
 *
 * La semántica de "crear si no existe" (RF-C6) es de **dos pasos**: primero
 * `GET /propietarios?tipo_documento=..&documento=..`, después `POST`. Sin
 * upsert, para reproducir el árbol de decisión del PRD §12.1.
 *
 * El mensaje no incluye el documento (Ley 1581 de 2012, R36).
 */
export class PerfilYaExisteError extends AppError {
  readonly code = 'PERFIL_YA_EXISTE';
  readonly httpStatus = 409;

  constructor(
    message = 'Ya existe un perfil con ese documento en esta inmobiliaria.',
  ) {
    super(message);
  }
}

/**
 * No hay cuenta de giro resoluble (**R29**, **R30**).
 *
 * Cubre dos casos a propósito indistinguibles para el cliente: el override
 * recibido no pertenece al mismo propietario y tenant, o no existe cuenta
 * predeterminada activa. `resolverCuentaDeGiro` nunca devuelve `null` ni una
 * cuenta arbitraria: un giro del canon a la cuenta equivocada es dinero
 * enviado a otra persona.
 */
export class CuentaDeGiroInvalidaError extends AppError {
  readonly code = 'CUENTA_DE_GIRO_INVALIDA';
  readonly httpStatus = 400;

  constructor(
    message = 'No hay una cuenta de giro válida para este propietario.',
  ) {
    super(message);
  }
}

export {
  SinContextoDeTenantError,
  type ContextoPeticion,
} from '../../../../common/database/cliente-tenant';
export { ResourceNotFoundError } from '../../../../common/errors';
