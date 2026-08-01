import { z } from 'zod';

/**
 * `PUT /configuracion/retencion/:anio` (**R6**, **R11**).
 *
 * `porcentaje` llega como **cadena decimal exacta**, no como `number`:
 * convertir a `number` de JavaScript en el borde introduciría error de coma
 * flotante en un valor con consecuencias fiscales (R11, docs/conventions.md).
 * El `pg` lo devolverá como `string`; así viaja de punta a punta sin pasar
 * por `float`.
 *
 * El patrón admite hasta 3 enteros y 2 decimales (cota de `numeric(5,2)`), con
 * `3.5` normalizado a `3.50` por la base; `'3.50'` se devuelve como `'3.50'`
 * exacto.
 */
export const esquemaEstablecerTarifa = z
  .object({
    porcentaje: z
      .string()
      .trim()
      .regex(/^\d{1,3}(\.\d{1,2})?$/, 'El porcentaje debe ser un decimal exacto.'),
  })
  .strict();

export type EstablecerTarifaDto = z.infer<typeof esquemaEstablecerTarifa>;

/**
 * `:anio` de la ruta (R1): año calendario completo, no fecha.
 */
export const esquemaAnio = z.coerce.number().int().min(2000).max(2100);
export type AnioRuta = z.infer<typeof esquemaAnio>;
