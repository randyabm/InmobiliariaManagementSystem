import { z } from 'zod';

/** `POST /propiedades/:id/ciclo-vida/transiciones/:claveTransicion` (R5). */
export const esquemaEjecutarCicloVida = z
  .object({
    contexto: z.record(z.unknown()).default({}),
  })
  .strict();

export type EjecutarCicloVidaDto = z.infer<typeof esquemaEjecutarCicloVida>;
