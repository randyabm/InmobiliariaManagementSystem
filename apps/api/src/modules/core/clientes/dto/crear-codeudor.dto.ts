import { TIPOS_CODEUDOR, TIPOS_DOCUMENTO } from '@inmobiliaria/types';
import { z } from 'zod';

const texto = (max = 200) => z.string().trim().min(1).max(max);
const textoOpcional = (max = 200) => texto(max).nullish();

/**
 * `POST /inquilinos/:id/codeudores` (**R12**).
 *
 * `tipo` es `CODEUDOR` o `COARRENDATARIO` (R2). El documento se exige junto
 * con su tipo: es la clave de unicidad por inquilino (R14, D-7).
 *
 * El `email` y el `celular` son datos de contacto de un **tercero** (Ley
 * 1581 de 2012): se capturan, pero no se convierten en credenciales ni se
 * copian a `user` (enmienda D-8/D-9 del spec).
 */
export const esquemaCrearCodeudor = z
  .object({
    tipo: z.enum(TIPOS_CODEUDOR),
    nombre: texto(),
    tipo_documento: z.enum(TIPOS_DOCUMENTO),
    documento: texto(50),
    email: z.string().trim().email().max(320).nullish(),
    celular: textoOpcional(50),
  })
  .strict();

export type CrearCodeudorDto = z.infer<typeof esquemaCrearCodeudor>;
