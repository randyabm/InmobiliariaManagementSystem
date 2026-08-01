import { check, index, integer, jsonb, pgTable, timestamp, uuid, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { inventario } from './inventario';
import { tenant } from './tenant';
import { user } from './user';

/**
 * Versión del inventario ante cada ronda de negociación (feature #22,
 * RF-I6). `snapshot_json` = zonas/ítems activos con respuestas (PA-22-1).
 */
export const inventarioVersion = pgTable(
  'inventario_version',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    inventarioId: uuid('inventario_id')
      .notNull()
      .references(() => inventario.id),
    version: integer('version').notNull(),
    snapshotJson: jsonb('snapshot_json').notNull(),
    creadoPor: uuid('creado_por').references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('inventario_version_version_check', sql`${t.version} > 0`),
    uniqueIndex('inventario_version_inventario_version_key').on(t.inventarioId, t.version),
    index('inventario_version_tenant_inventario_idx').on(t.tenantId, t.inventarioId),
  ],
);
