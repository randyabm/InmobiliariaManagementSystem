import { TIPOS_DOCUMENTO } from '@inmobiliaria/types';
import { z } from 'zod';

const texto = (max = 200) => z.string().trim().min(1).max(max);
const textoOpcional = (max = 200) => texto(max).nullish();

/**
 * `POST /propietarios` (**R10**, **R16**, D-5).
 *
 * `email` es **opcional**: hay propietarios reales sin correo y obligarlo
 * produce datos falsos (D-5). El inquilino sí lo exige (RF-C4, R19).
 *
 * No hay campo de tarifa ni porcentaje de retención: **D-2**, la tarifa es
 * configuración del tenant y llega en la feature #25 (**R17**).
 */
export const esquemaCrearPropietario = z
  .object({
    nombre: texto(),
    tipo_documento: z.enum(TIPOS_DOCUMENTO),
    documento: texto(50),
    email: z.string().trim().email().max(320).nullish(),
    telefono: textoOpcional(50),
    direccion_notificacion: textoOpcional(),
    ciudad: textoOpcional(100),
    sujeto_retencion: z.boolean().optional(),
  })
  .strict();

export type CrearPropietarioDto = z.infer<typeof esquemaCrearPropietario>;

/**
 * `PATCH /propietarios/:id` (**R13**, **R16**).
 *
 * Solo campos editables. `tipo_documento` y `documento` NO son editables aquí:
 * son la clave de identidad del cliente dentro del tenant (**R9**, D-7) y
 * cambiarlos por un PATCH parcial permitiría suplantar a otro perfil.
 */
export const esquemaActualizarPropietario = z
  .object({
    nombre: texto().optional(),
    email: z.string().trim().email().max(320).nullish(),
    telefono: textoOpcional(50),
    direccion_notificacion: textoOpcional(),
    ciudad: textoOpcional(100),
    sujeto_retencion: z.boolean().optional(),
  })
  .strict()
  .refine((datos) => Object.keys(datos).length > 0, {
    message: 'Debes enviar al menos un campo editable.',
  });

export type ActualizarPropietarioDto = z.infer<typeof esquemaActualizarPropietario>;

/** `GET /propietarios?tipo_documento=..&documento=..` (**R23**, D-4). */
export const esquemaBuscarPorDocumento = z
  .object({
    tipo_documento: z.enum(TIPOS_DOCUMENTO),
    documento: texto(50),
  })
  .strict();

export type BuscarPorDocumentoDto = z.infer<typeof esquemaBuscarPorDocumento>;
