import { boolean, check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { inventario } from './inventario';
import { tenant } from './tenant';

/**
 * Zona del snapshot del inventario (feature #12, R2).
 *
 * Copiada de la plantilla en la materialización (R4): `plantilla_zona_id`
 * guarda el origen, pero editar la plantilla después no altera este
 * snapshot (RF-I24). `repetible` se copia de la plantilla.
 */
export const inventarioZona = pgTable(
  'inventario_zona',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    inventarioId: uuid('inventario_id')
      .notNull()
      .references(() => inventario.id),
    nombre: text('nombre').notNull(),
    repetible: boolean('repetible').notNull().default(false),
    orden: integer('orden').notNull().default(0),
    plantillaZonaId: uuid('plantilla_zona_id'),
    activo: boolean('activo').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('inventario_zona_nombre_check', sql`length(${t.nombre}) > 0`),
    index('inventario_zona_tenant_inventario_idx').on(t.tenantId, t.inventarioId),
  ],
);
