import { index, integer, numeric, pgTable, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { tenant } from './tenant';

/**
 * Tarifa de retención en la fuente del tenant, por año (RF-C5, D-2). Feature
 * #25.
 *
 * La tarifa la fija la ley y cambia por año: es configuración **del tenant y
 * por año**, nunca una columna de `perfil_propietario` (R5). `sujeto_retencion`
 * (quién aplica) vive en el perfil; la tarifa (cuánto aplica) vive aquí, y la
 * feature #25 no calcula dinero: solo resuelve el porcentaje (R8–R10).
 *
 * `porcentaje` es `numeric(5,2)`, nunca `float` (`docs/conventions.md`,
 * "Dinero y fechas"): el driver `pg` lo devuelve como cadena y se transporta
 * como `string` en toda frontera pública (R11), sin pasar por `number`.
 */
export const tarifaRetencion = pgTable(
  'tarifa_retencion',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    /** Año calendario completo, no fecha: la tarifa rige el año fiscal (R1). */
    anio: integer('anio').notNull(),
    porcentaje: numeric('porcentaje', { precision: 5, scale: 2 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('tarifa_retencion_tenant_anio_key').on(t.tenantId, t.anio),
    index('tarifa_retencion_tenant_anio_idx').on(t.tenantId, t.anio),
  ],
);
