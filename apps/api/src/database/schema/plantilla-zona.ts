import { boolean, index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { plantillaInmueble } from './plantilla-inmueble';

/**
 * Zona de una plantilla (feature #11, R2, §8.8.3).
 *
 * `repetible` permite instanciar la zona N veces en el inventario real
 * (#12); `obligatoria` exige su presencia; `orden` fija la presentación.
 * La baja es lógica (`activo = false`) y sus ítems quedan inertes (R7).
 */
export const plantillaZona = pgTable(
  'plantilla_zona',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    plantillaId: uuid('plantilla_id')
      .notNull()
      .references(() => plantillaInmueble.id),
    nombre: text('nombre').notNull(),
    repetible: boolean('repetible').notNull().default(false),
    obligatoria: boolean('obligatoria').notNull().default(false),
    orden: integer('orden').notNull().default(0),
    activo: boolean('activo').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('plantilla_zona_plantilla_nombre_key').on(t.plantillaId, t.nombre),
    index('plantilla_zona_plantilla_idx').on(t.plantillaId),
  ],
);
