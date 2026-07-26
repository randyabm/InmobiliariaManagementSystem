import { TIPOS_CUENTA, TIPOS_DOCUMENTO } from '@inmobiliaria/types';
import { z } from 'zod';

const texto = (max = 200) => z.string().trim().min(1).max(max);

/** `POST /propietarios/:id/cuentas-bancarias` (**R11**). */
export const esquemaCrearCuentaBancaria = z
  .object({
    banco: texto(100),
    tipo_cuenta: z.enum(TIPOS_CUENTA),
    numero_cuenta: texto(40),
    titular_nombre: texto(),
    titular_tipo_documento: z.enum(TIPOS_DOCUMENTO),
    titular_documento: texto(50),
  })
  .strict();

export type CrearCuentaBancariaDto = z.infer<typeof esquemaCrearCuentaBancaria>;

/**
 * `PATCH /propietarios/:idPropietario/cuentas-bancarias/:idCuenta` (**R15**).
 *
 * Solo se admite `es_predeterminada: true`, que es literalmente lo que pide
 * R15. No se acepta `false`: dejar a un propietario sin cuenta predeterminada
 * haría irresoluble el giro del canon (R30) y el spec no define esa
 * operación. Cambiar de predeterminada se hace marcando la nueva.
 *
 * Los datos bancarios en sí (banco, número, titular) no son editables aquí:
 * el spec no lo pide y modificar una cuenta de giro en caliente es una acción
 * con consecuencias económicas que merece su propio requirement.
 */
export const esquemaActualizarCuentaBancaria = z
  .object({
    es_predeterminada: z.literal(true),
  })
  .strict();

export type ActualizarCuentaBancariaDto = z.infer<
  typeof esquemaActualizarCuentaBancaria
>;
