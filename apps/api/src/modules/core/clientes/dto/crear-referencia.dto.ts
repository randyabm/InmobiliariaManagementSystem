import { z } from 'zod';

const texto = (max = 200) => z.string().trim().min(1).max(max);
const textoOpcional = (max = 200) => texto(max).nullish();

/**
 * `POST /inquilinos/:id/referencias` (**R15**).
 *
 * `nombre` y `telefono` son obligatorios (R3); `relacion` es texto libre y
 * nullable — el PRD no define una taxonomía de referencias y no se inventa
 * una —; `email` opcional. Igual que en el codeudor: datos de contacto de un
 * tercero, nunca credenciales.
 */
export const esquemaCrearReferencia = z
  .object({
    nombre: texto(),
    telefono: texto(50),
    relacion: textoOpcional(120),
    email: z.string().trim().email().max(320).nullish(),
  })
  .strict();

export type CrearReferenciaDto = z.infer<typeof esquemaCrearReferencia>;
