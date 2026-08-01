import { TIPOS_CODEUDOR } from '@inmobiliaria/types';
import { z } from 'zod';

const texto = (max = 200) => z.string().trim().min(1).max(max);
const textoOpcional = (max = 200) => texto(max).nullish();

/**
 * `PATCH /inquilinos/:idInquilino/codeudores/:idCodeudor` (**R13**).
 *
 * `tipo_documento` y `documento` no son editables: son la clave de unicidad
 * del codeudor dentro del inquilino (R14).
 */
export const esquemaActualizarCodeudor = z
  .object({
    tipo: z.enum(TIPOS_CODEUDOR).optional(),
    nombre: texto().optional(),
    email: z.string().trim().email().max(320).nullish(),
    celular: textoOpcional(50),
  })
  .strict()
  .refine((datos) => Object.keys(datos).length > 0, {
    message: 'Debes enviar al menos un campo editable.',
  });

export type ActualizarCodeudorDto = z.infer<typeof esquemaActualizarCodeudor>;
