import { check, index, pgTable, text, timestamp, uuid, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { inventario } from './inventario';
import { tenant } from './tenant';
import { perfilInquilino } from './perfil-inquilino';

/**
 * Invitación de revisión (feature #13, R1, §design 2).
 *
 * `token_hash` es SHA-256 del token de 48 B: el token en claro solo existe
 * en la respuesta HTTP (R12). `usada_en` impide el reuso (R3); la
 * búsqueda sin sesión va por la función SECURITY DEFINER
 * `invitacion_por_token` (PA-13-4), nunca por esta tabla directamente.
 */
export const invitacionInventario = pgTable(
  'invitacion_inventario',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    inventarioId: uuid('inventario_id')
      .notNull()
      .references(() => inventario.id),
    perfilInquilinoId: uuid('perfil_inquilino_id')
      .notNull()
      .references(() => perfilInquilino.id),
    tokenHash: text('token_hash').notNull(),
    expiraEn: timestamp('expira_en', { withTimezone: true }).notNull(),
    usadaEn: timestamp('usada_en', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('invitacion_inventario_token_hash_check', sql`length(${t.tokenHash}) = 64`),
    index('invitacion_inventario_tenant_idx').on(t.tenantId),
    uniqueIndex('invitacion_inventario_token_hash_unique_idx').on(t.tokenHash),
  ],
);
