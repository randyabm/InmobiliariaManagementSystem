import { boolean, check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { inventarioZona } from './inventario-zona';
import { tenant } from './tenant';

/**
 * Ítem del snapshot del inventario (feature #12, R2).
 *
 * `estado_checklist` (BUENO/REGULAR/MALO) y `valor_respuesta` (jsonb)
 * guardan la respuesta del empleado; `comentario` la observación libre.
 * `creado_offline`/`sincronizado_en` son para la PWA de campo (#15).
 */
export const inventarioItem = pgTable(
  'inventario_item',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    zonaId: uuid('zona_id')
      .notNull()
      .references(() => inventarioZona.id),
    nombre: text('nombre').notNull(),
    fieldType: text('field_type').notNull(),
    opcionesJson: jsonb('opciones_json'),
    estadoChecklist: text('estado_checklist'),
    valorRespuesta: jsonb('valor_respuesta'),
    comentario: text('comentario'),
    fotoObligatoria: boolean('foto_obligatoria').notNull().default(false),
    plantillaItemId: uuid('plantilla_item_id'),
    creadoOffline: boolean('creado_offline').notNull().default(false),
    sincronizadoEn: timestamp('sincronizado_en', { withTimezone: true }),
    activo: boolean('activo').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'inventario_item_field_type_check',
      sql`${t.fieldType} IN ('estado', 'si_no', 'si_no_estado', 'conteo', 'seleccion', 'texto')`,
    ),
    check(
      'inventario_item_estado_checklist_check',
      sql`${t.estadoChecklist} IN ('BUENO', 'REGULAR', 'MALO')`,
    ),
    check(
      'inventario_item_opciones_check',
      sql`(${t.fieldType} = 'seleccion') = (${t.opcionesJson} IS NOT NULL)`,
    ),
    index('inventario_item_tenant_zona_idx').on(t.tenantId, t.zonaId),
  ],
);
