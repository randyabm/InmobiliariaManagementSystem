import { AppError } from '../../../../common/errors';

/** R6 — ya existe una instancia de esa definición para esa entidad. */
export class InstanciaYaExisteError extends AppError {
  readonly code = 'INSTANCIA_YA_EXISTE';
  readonly httpStatus = 409;

  constructor(message = 'Ya existe una instancia de este workflow para esa entidad.') {
    super(message);
  }
}

/**
 * R7 — la transición no está disponible. Un solo cuerpo para estado
 * incorrecto, transición inactiva, condición falsa o inexistente: distinguir
 * filtraría el estado de la máquina (R9 ya lo expone a quien puede verlo).
 */
export class TransicionNoDisponibleError extends AppError {
  readonly code = 'TRANSICION_NO_DISPONIBLE';
  readonly httpStatus = 409;

  constructor(message = 'La transición no está disponible en el estado actual.') {
    super(message);
  }
}

/** R5 — las plantillas del sistema son de solo lectura por API (RF-W2). */
export class DefinicionSistemaNoEditableError extends AppError {
  readonly code = 'DEFINICION_SISTEMA_NO_EDITABLE';
  readonly httpStatus = 409;

  constructor(message = 'La definición del sistema no puede editarse.') {
    super(message);
  }
}

/** R8 — la cascada automática excedió el límite; la petición entera aborta. */
export class CicloAutomaticoError extends AppError {
  readonly code = 'CICLO_AUTOMATICO';
  readonly httpStatus = 409;

  constructor(message = 'La cadena de transiciones automáticas excedió el límite.') {
    super(message);
  }
}
