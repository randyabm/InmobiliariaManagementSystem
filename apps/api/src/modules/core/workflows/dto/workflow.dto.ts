import { OPERADORES_CONDICION, TIPOS_EJECUCION } from '@inmobiliaria/types';
import { z } from 'zod';

const uuid = () => z.string().uuid();

/** `POST /workflows/:id/instancias` (R6). La entidad es opaca para el motor. */
export const esquemaCrearInstancia = z
  .object({
    entidad_tipo: z.string().trim().min(1).max(60),
    entidad_id: uuid(),
    contexto: z.record(z.unknown()).default({}),
  })
  .strict();

export type CrearInstanciaDto = z.infer<typeof esquemaCrearInstancia>;

/** `POST /workflows/instancias/:idInstancia/transiciones/:idTransicion` (R7). */
export const esquemaEjecutarTransicion = z
  .object({
    contexto: z.record(z.unknown()).default({}),
  })
  .strict();

export type EjecutarTransicionDto = z.infer<typeof esquemaEjecutarTransicion>;

/**
 * `POST /workflows/:id/transiciones` (R5). La condición es un array de
 * cláusulas whitelisted (R3): un operador fuera de la lista se rechaza en el
 * borde, no se convierte en falso silenciosamente al crear.
 */
export const esquemaAnadirTransicion = z
  .object({
    clave: z.string().trim().min(1).max(60),
    origen_estado_id: uuid(),
    destino_estado_id: uuid(),
    tipo_ejecucion: z.enum(TIPOS_EJECUCION),
    roles_requeridos: z.array(z.string().trim().min(1)).default([]),
    condicion: z
      .array(
        z
          .object({
            campo: z.string().trim().min(1).max(120),
            operador: z.enum(OPERADORES_CONDICION),
            valor: z.unknown().optional(),
          })
          .strict(),
      )
      .default([]),
    orden: z.number().int().min(0).default(0),
  })
  .strict();

export type AnadirTransicionDto = z.infer<typeof esquemaAnadirTransicion>;
