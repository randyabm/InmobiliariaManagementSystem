import { check, index, integer, jsonb, pgTable, text, timestamp, uuid, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { propiedad } from './propiedad';
import { tenant } from './tenant';
import { user } from './user';

/**
 * Plantilla de contrato (feature #16, RF-CT1/RF-CT2, §13.2).
 *
 * `property_id` NULL = clausulado común del tenant (una sola base por
 * tenant); con propiedad = copia pre-rellena (RF-CT2, PA-16-1). `cuerpo`
 * usa `{campo}` para los merge fields (PA-16-2).
 */
export const contractTemplate = pgTable(
  'contract_template',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    propertyId: uuid('property_id').references(() => propiedad.id),
    nombre: text('nombre').notNull(),
    cuerpo: text('cuerpo').notNull(),
    mergeFieldsJson: jsonb('merge_fields_json').notNull(),
    version: integer('version').notNull().default(1),
    validadoPor: uuid('validado_por').references(() => user.id),
    estado: text('estado').notNull().default('borrador'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'contract_template_estado_check',
      sql`${t.estado} IN ('borrador', 'validado')`,
    ),
    uniqueIndex('contract_template_tenant_base_key')
      .on(t.tenantId)
      .where(sql`${t.propertyId} IS NULL`),
    uniqueIndex('contract_template_tenant_property_key').on(t.tenantId, t.propertyId),
    index('contract_template_tenant_idx').on(t.tenantId),
  ],
);
