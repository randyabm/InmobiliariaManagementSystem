import { z } from 'zod';

import { esquemaCrearInquilino } from '../../clientes/dto/inquilino.dto';
import { esquemaCrearPropietario } from '../../clientes/dto/propietario.dto';
import { esquemaCrearPropiedad } from './crear-propiedad.dto';

const uuid = () => z.string().uuid();

/**
 * `POST /propiedades/ingreso` (feature #9, RF-PI1/RF-PI2).
 *
 * El propietario (y el inquilino en el escenario B) llegan como **id de un
 * perfil existente** o como **datos en línea** (crear si no existe, RF-C6).
 * La `propiedad` reutiliza los campos de la ficha (#6) SIN
 * `propietario_principal_id`: el servicio lo resuelve del propietario.
 */

/** id de un perfil existente, o sus datos para crearlo en línea. */
const perfilIdODatos = <T extends z.ZodTypeAny>(esquemaDatos: T) =>
  z
    .object({
      perfil_id: uuid().optional(),
      datos: esquemaDatos.optional(),
    })
    .strict()
    .refine(
      (datos) => (datos.perfil_id !== undefined) !== (datos.datos !== undefined),
      { message: 'Debes enviar `perfil_id` o `datos`, no ambos ni ninguno.' },
    );

const esquemaPropietario = perfilIdODatos(esquemaCrearPropietario);

const esquemaInquilino = perfilIdODatos(esquemaCrearInquilino);

/** `propiedad` sin `propietario_principal_id` (lo resuelve el servicio). */
const esquemaPropiedadDelIngreso = esquemaCrearPropiedad.omit({
  propietario_principal_id: true,
});

/**
 * Unión discriminada por `escenario` (R1, R2, R5): `ARRENDADA` exige
 * `inquilino`.
 */
export const esquemaIngresoPropiedad = z.discriminatedUnion('escenario', [
  z
    .object({
      escenario: z.literal('VACANTE'),
      propietario: esquemaPropietario,
      propiedad: esquemaPropiedadDelIngreso,
    })
    .strict(),
  z
    .object({
      escenario: z.literal('ARRENDADA'),
      propietario: esquemaPropietario,
      propiedad: esquemaPropiedadDelIngreso,
      inquilino: esquemaInquilino,
    })
    .strict(),
]);

export type IngresoPropiedadDto = z.infer<typeof esquemaIngresoPropiedad>;
export type IngresoEscenario = IngresoPropiedadDto['escenario'];
