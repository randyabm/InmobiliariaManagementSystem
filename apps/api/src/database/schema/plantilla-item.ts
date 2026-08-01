import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { plantillaZona } from './plantilla-zona';

/**
 * Ítem de una zona (feature #11, R3, §8.8.2).
 *
 * `field_type` fija cómo se evalúa; `opciones_json` solo se admite con
 * `seleccion` (CHECK R9); `obligatorio`/`foto_obligatoria` son banderas que
 * #12 validará. La baja es lógica.
 */
export const plantillaItem = pgTable(
  'plantilla_item',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    zonaId: uuid('zona_id')
      .notNull()
      .references(() => plantillaZona.id),
    nombre: text('nombre').notNull(),
    fieldType: text('field_type').notNull(),
    opcionesJson: jsonb('opciones_json'),
    obligatorio: boolean('obligatorio').notNull().default(false),
    fotoObligatoria: boolean('foto_obligatoria').notNull().default(false),
    orden: integer('orden').notNull().default(0),
    activo: boolean('activo').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('plantilla_item_zona_nombre_key').on(t.zonaId, t.nombre),
    check(
      'plantilla_item_field_type_check',
      sql`${t.fieldType} IN ('estado', 'si_no', 'si_no_estado', 'conteo', 'seleccion', 'texto')`,
    ),
    check(
      'plantilla_item_opciones_check',
      sql`(${t.fieldType} = 'seleccion') = (${t.opcionesJson} IS NOT NULL)`,
    ),
    index('plantilla_item_zona_idx').on(t.zonaId),
  ],
);
