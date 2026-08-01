import { sql } from 'drizzle-orm';
import { index, pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { perfilInquilino } from './perfil-inquilino';
import { propiedad } from './propiedad';
import { tenant } from './tenant';

/**
 * Línea de tiempo de arrendatarios de la propiedad (RF-P3, R3). Feature #6.
 *
 * `hasta` NULL = ocupación vigente; el índice único **parcial** (`WHERE
 * hasta IS NULL`) garantiza a lo sumo una vigente por propiedad. Lo escribe
 * `OcupacionService` en la misma transacción que cambia
 * `propiedad.inquilino_actual_id` (R11): no hay instante en que la ficha y
 * el historial discrepen.
 */
export const historialOcupacion = pgTable(
  'historial_ocupacion',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    propiedadId: uuid('propiedad_id')
      .notNull()
      .references(() => propiedad.id),
    perfilInquilinoId: uuid('perfil_inquilino_id')
      .notNull()
      .references(() => perfilInquilino.id),
    desde: timestamp('desde', { withTimezone: true }).notNull(),
    hasta: timestamp('hasta', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('historial_ocupacion_vigente_key')
      .on(t.propiedadId)
      .where(sql`${t.hasta} IS NULL`),
    index('historial_ocupacion_propiedad_desde_idx').on(t.propiedadId, t.desde),
  ],
);
