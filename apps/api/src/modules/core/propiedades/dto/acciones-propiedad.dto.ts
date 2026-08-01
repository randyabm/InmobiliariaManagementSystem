import { z } from 'zod';

const uuid = () => z.string().uuid();

/**
 * `PATCH /propiedades/:id/inquilino-actual` (R11).
 *
 * `perfil_inquilino_id` puede ser `null` para declarar la propiedad vacante
 * (cierra la ocupación vigente sin abrir otra).
 */
export const esquemaAsignarInquilinoActual = z
  .object({
    perfil_inquilino_id: uuid().nullable(),
  })
  .strict();

export type AsignarInquilinoActualDto = z.infer<typeof esquemaAsignarInquilinoActual>;

/**
 * `POST /propiedades/:id/propietarios` (R10) — un propietario adicional.
 */
export const esquemaAnadirPropietario = z
  .object({
    perfil_propietario_id: uuid(),
  })
  .strict();

export type AnadirPropietarioDto = z.infer<typeof esquemaAnadirPropietario>;

/**
 * `DELETE /propiedades/:id/fotos` (R17) — quitar una clave del array.
 */
export const esquemaQuitarFoto = z
  .object({
    clave: z.string().trim().min(1).max(120),
  })
  .strict();

export type QuitarFotoDto = z.infer<typeof esquemaQuitarFoto>;
