import { AppError } from '../../../../common/errors';

/**
 * El (tipo_documento, documento) ya está registrado como codeudor de ese
 * inquilino (**R14**).
 *
 * La UNIQUE (tenant_id, perfil_inquilino_id, tipo_documento, documento) de
 * R2 es la barrera de verdad — este error traduce su violación en el service,
 * igual que `PerfilYaExisteError` traduce la del perfil (R24 de la #5).
 *
 * El mensaje no incluye el documento (Ley 1581 de 2012, R24): quien lo
 * recibe acaba de teclearlo.
 */
export class CodeudorYaExisteError extends AppError {
  readonly code = 'CODEUDOR_YA_EXISTE';
  readonly httpStatus = 409;

  constructor(
    message = 'Ese documento ya está registrado como codeudor de este inquilino.',
  ) {
    super(message);
  }
}
