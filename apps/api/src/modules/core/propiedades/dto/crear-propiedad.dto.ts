import { TIPOS_PROPIEDAD } from '@inmobiliaria/types';
import { z } from 'zod';

const texto = (max = 200) => z.string().trim().min(1).max(max);
const textoOpcional = (max = 200) => texto(max).nullish();
const uuid = () => z.string().uuid();

/**
 * Cantidades en cadena decimal exacta (R9), mismo criterio que #25 R11:
 * `numeric` se transporta como `string` y nunca pasa por `number`.
 */
const dinero = () =>
  z
    .string()
    .trim()
    .regex(/^\d{1,10}(\.\d{1,2})?$/, 'Debe ser un importe decimal exacto.');
const area = () =>
  z
    .string()
    .trim()
    .regex(/^\d{1,8}(\.\d{1,2})?$/, 'Debe ser un área decimal exacta.');
const porcentaje = () =>
  z
    .string()
    .trim()
    .regex(/^\d{1,3}(\.\d{1,2})?$/, 'Debe ser un porcentaje decimal exacto.');

/**
 * `POST /propiedades` (R5).
 *
 * Los grupos de datos del PRD (RF-P1): identificación, comercial,
 * administración PH y contable. `propietario_principal_id` es obligatorio
 * (R1): el giro se resuelve contra él (R8). `cuenta_bancaria_id` es el
 * override (dependencia #5) y se valida en el servicio contra el principal.
 *
 * `fotos` no se reciben aquí: se gestionan por su endpoint (R17).
 */
export const esquemaCrearPropiedad = z
  .object({
    // Identificación
    direccion: texto(),
    tipo: z.enum(TIPOS_PROPIEDAD),
    area: area(),
    matricula_inmobiliaria: textoOpcional(60),
    estrato: z.number().int().min(1).max(6).nullish(),
    parqueaderos: z.number().int().min(0).max(99).default(0),
    depositos: z.number().int().min(0).max(99).default(0),
    // Comercial
    canon: dinero(),
    valor_administracion: dinero().nullish(),
    canon_incluye_administracion: z.boolean().default(false),
    incremento_anual_pactado: porcentaje().nullish(),
    // Administración PH
    nombre_conjunto: textoOpcional(120),
    contacto_admin_nombre: textoOpcional(),
    contacto_admin_telefono: textoOpcional(50),
    contacto_admin_correo: z.string().trim().email().max(320).nullish(),
    // Contable
    propietario_principal_id: uuid(),
    cuenta_bancaria_id: uuid().nullish(),
  })
  .strict();

export type CrearPropiedadDto = z.infer<typeof esquemaCrearPropiedad>;

/**
 * `PATCH /propiedades/:id` (R7) — todos los campos opcionales; al menos uno.
 *
 * `propietario_principal_id` puede cambiar: si llega junto con
 * `cuenta_bancaria_id`, el override se valida contra el NUEVO principal
 * (R8).
 */
export const esquemaActualizarPropiedad = esquemaCrearPropiedad
  .partial()
  .extend({
    parqueaderos: z.number().int().min(0).max(99).optional(),
    depositos: z.number().int().min(0).max(99).optional(),
    canon_incluye_administracion: z.boolean().optional(),
  })
  .refine((datos) => Object.keys(datos).length > 0, {
    message: 'Debes enviar al menos un campo editable.',
  });

export type ActualizarPropiedadDto = z.infer<typeof esquemaActualizarPropiedad>;
