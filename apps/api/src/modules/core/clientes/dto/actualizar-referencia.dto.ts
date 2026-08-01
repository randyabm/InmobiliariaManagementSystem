import { z } from 'zod';

const texto = (max = 200) => z.string().trim().min(1).max(max);
const textoOpcional = (max = 200) => texto(max).nullish();

/**
 * `PATCH /inquilinos/:idInquilino/referencias/:idReferencia` (**R16**).
 */
export const esquemaActualizarReferencia = z
  .object({
    nombre: texto().optional(),
    telefono: texto(50).optional(),
    relacion: textoOpcional(120),
    email: z.string().trim().email().max(320).nullish(),
  })
  .strict()
  .refine((datos) => Object.keys(datos).length > 0, {
    message: 'Debes enviar al menos un campo editable.',
  });

export type ActualizarReferenciaDto = z.infer<typeof esquemaActualizarReferencia>;
