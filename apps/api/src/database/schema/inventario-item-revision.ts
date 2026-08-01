import { check, index, pgTable, text, timestamp, uuid, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { inventarioItem } from './inventario-item';
import { perfilInquilino } from './perfil-inquilino';
import { tenant } from './tenant';

/**
 * Revisión de un ítem por el inquilino (feature #13, R6, §design 4).
 *
 * Una sola ronda (PA-13-2): UNIQUE (item_id, perfil_inquilino_id). Al
 * objetar, `comentario` es obligatorio (lo valida el servicio; R6).
 */
export const inventarioItemRevision = pgTable(
  'inventario_item_revision',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    itemId: uuid('item_id')
      .notNull()
      .references(() => inventarioItem.id),
    perfilInquilinoId: uuid('perfil_inquilino_id')
      .notNull()
      .references(() => perfilInquilino.id),
    respuesta: text('respuesta').notNull(),
    comentario: text('comentario'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'inventario_item_revision_respuesta_check',
      sql`${t.respuesta} IN ('ACEPTADO', 'OBJETADO')`,
    ),
    index('inventario_item_revision_tenant_item_idx').on(t.tenantId, t.itemId),
    index('inventario_item_revision_tenant_perfil_idx').on(t.tenantId, t.perfilInquilinoId),
    uniqueIndex('inventario_item_revision_item_perfil_unique_idx')
      .on(t.itemId, t.perfilInquilinoId),
  ],
);
