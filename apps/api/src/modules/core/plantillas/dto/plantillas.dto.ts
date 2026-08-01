import { FIELD_TYPES } from '@inmobiliaria/types';
import { z } from 'zod';

/** `POST /plantillas/:id/zonas` y `PATCH .../:idZona` (R7). */
export const esquemaZona = z
  .object({
    nombre: z.string().trim().min(1).max(120),
    repetible: z.boolean().default(false),
    obligatoria: z.boolean().default(false),
    orden: z.number().int().min(0).default(0),
  })
  .strict();

export const esquemaActualizarZona = esquemaZona.partial().refine(
  (datos) => Object.keys(datos).length > 0,
  { message: 'Debes enviar al menos un campo editable.' },
);

/** `POST .../items` y `PATCH .../items/:idItem` (R8, R9). */
const baseItem = z
  .object({
    nombre: z.string().trim().min(1).max(120),
    field_type: z.enum(FIELD_TYPES),
    opciones_json: z.array(z.string().trim().min(1)).max(50).nullish(),
    obligatorio: z.boolean().default(false),
    foto_obligatoria: z.boolean().default(false),
    orden: z.number().int().min(0).default(0),
  })
  .strict();

/** R9: la coherencia opciones ↔ seleccion se valida en el borde. */
export const esquemaItem = baseItem.superRefine((datos, ctx) => {
  if (datos.field_type === 'seleccion') {
    if (!datos.opciones_json || datos.opciones_json.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Un ítem de selección debe declarar opciones_json.',
        path: ['opciones_json'],
      });
    }
  } else if (datos.opciones_json !== undefined && datos.opciones_json !== null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'opciones_json solo se admite con field_type = seleccion.',
      path: ['opciones_json'],
    });
  }
});

export const esquemaActualizarItem = baseItem
  .partial()
  .superRefine((datos, ctx) => {
    if (datos.field_type === 'seleccion' && datos.opciones_json !== undefined) {
      if (!datos.opciones_json || datos.opciones_json.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Un ítem de selección debe declarar opciones_json.',
          path: ['opciones_json'],
        });
      }
    }
  })
  .refine((datos) => Object.keys(datos).length > 0, {
    message: 'Debes enviar al menos un campo editable.',
  });

export type CrearZonaDto = z.infer<typeof esquemaZona>;
export type ActualizarZonaDto = z.infer<typeof esquemaActualizarZona>;
export type CrearItemDto = z.infer<typeof esquemaItem>;
export type ActualizarItemDto = z.infer<typeof esquemaActualizarItem>;
