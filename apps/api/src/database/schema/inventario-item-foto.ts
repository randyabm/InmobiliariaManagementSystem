import { boolean, check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { inventarioItem } from './inventario-item';
import { tenant } from './tenant';

/**
 * Foto de un ítem (feature #12, R3, §8.7).
 *
 * El binario vive en object storage (#6); la base guarda clave, hash
 * SHA-256 y autor. La baja es lógica (`activo = false`) y el objeto se
 * conserva (PA-12-4). `revision_id` (feature #13) vincula la foto del
 * inquilino a su revisión.
 */
export const inventarioItemFoto = pgTable(
  'inventario_item_foto',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    itemId: uuid('item_id')
      .notNull()
      .references(() => inventarioItem.id),
    claveStorage: text('clave_storage').notNull(),
    hashSha256: text('hash_sha256').notNull(),
    autor: text('autor').notNull(),
    revisionId: uuid('revision_id'),
    activo: boolean('activo').notNull().default(true),
    fechaCaptura: timestamp('fecha_captura', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('inventario_item_foto_autor_check', sql`${t.autor} IN ('EMPLEADO', 'INQUILINO')`),
    index('inventario_item_foto_tenant_item_idx').on(t.tenantId, t.itemId),
  ],
);
