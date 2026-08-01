import { check, index, pgTable, text, timestamp, uuid, boolean } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { propiedad } from './propiedad';
import { perfilInquilino } from './perfil-inquilino';
import { tenant } from './tenant';
import { user } from './user';

/**
 * Inventario (feature #12, R1, §8.7).
 *
 * El estado vive en una COLUMNA con CHECK (PA-12-1): el inventario nace en
 * `BORRADOR` y las transiciones (ENVIADO → … → CERRADO) las ejecutan las
 * features #13/#14. `creado_offline` y `sincronizado_en` los usará la PWA
 * de campo (#15).
 */
export const inventario = pgTable(
  'inventario',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    propiedadId: uuid('propiedad_id')
      .notNull()
      .references(() => propiedad.id),
    perfilInquilinoId: uuid('perfil_inquilino_id').references(() => perfilInquilino.id),
    tipoEvento: text('tipo_evento').notNull(),
    estado: text('estado').notNull().default('BORRADOR'),
    creadoPor: uuid('creado_por').references(() => user.id),
    revisionCompletadaEn: timestamp('revision_completada_en', { withTimezone: true }),
    activo: boolean('activo').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'inventario_tipo_evento_check',
      sql`${t.tipoEvento} IN ('ENTREGA', 'DEVOLUCION')`,
    ),
    check(
      'inventario_estado_check',
      sql`${t.estado} IN ('BORRADOR', 'ENVIADO', 'EN_REVISION', 'EN_NEGOCIACION', 'ACORDADO', 'FIRMADO', 'CERRADO')`,
    ),
    index('inventario_tenant_propiedad_estado_idx').on(
      t.tenantId,
      t.propiedadId,
      t.estado,
    ),
  ],
);
