import { MEDIOS_PREFERIDOS_CONTACTO, TIPOS_DOCUMENTO } from '@inmobiliaria/types';
import { z } from 'zod';

const texto = (max = 200) => z.string().trim().min(1).max(max);
const textoOpcional = (max = 200) => texto(max).nullish();

/**
 * `POST /inquilinos` (**R18**, **R19**).
 *
 * Los **seis** campos son obligatorios. El `email` **sí** lo es para el
 * inquilino: RF-C4 lo exige de forma explícita y la opcionalidad de D-5
 * aplica solo al propietario. Omitir cualquiera —o mandar un
 * `medio_preferido_contacto` fuera del enum— es 400 sin persistir nada.
 */
export const esquemaCrearInquilino = z
  .object({
    nombre: texto(),
    tipo_documento: z.enum(TIPOS_DOCUMENTO),
    documento: texto(50),
    email: z.string().trim().email().max(320),
    celular: texto(50),
    medio_preferido_contacto: z.enum(MEDIOS_PREFERIDOS_CONTACTO),
    telefono: textoOpcional(50),
  })
  .strict();

export type CrearInquilinoDto = z.infer<typeof esquemaCrearInquilino>;

/**
 * `PATCH /inquilinos/:id` (**R20**).
 *
 * `tipo_documento` y `documento` no son editables: son la clave de identidad
 * dentro del tenant (R9, D-7).
 */
export const esquemaActualizarInquilino = z
  .object({
    nombre: texto().optional(),
    email: z.string().trim().email().max(320).optional(),
    celular: texto(50).optional(),
    medio_preferido_contacto: z.enum(MEDIOS_PREFERIDOS_CONTACTO).optional(),
    telefono: textoOpcional(50),
  })
  .strict()
  .refine((datos) => Object.keys(datos).length > 0, {
    message: 'Debes enviar al menos un campo editable.',
  });

export type ActualizarInquilinoDto = z.infer<typeof esquemaActualizarInquilino>;
