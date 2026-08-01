import { check, index, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { contract } from './contract';
import { propiedad } from './propiedad';
import { tenant } from './tenant';

/**
 * Póliza de arrendamiento (feature #20, RF-PI7/RF-PI8, §12.4).
 *
 * `en_estudio` → `aprobada`/`rechazada`; la vigencia se valida en el motor
 * (hasta > desde cuando ambas existen).
 */
export const insurancePolicy = pgTable(
  'insurance_policy',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => propiedad.id),
    contractId: uuid('contract_id').references(() => contract.id),
    aseguradora: text('aseguradora').notNull(),
    numeroPoliza: text('numero_poliza'),
    vigenciaDesde: timestamp('vigencia_desde', { withTimezone: true }),
    vigenciaHasta: timestamp('vigencia_hasta', { withTimezone: true }),
    valorCobertura: numeric('valor_cobertura', { precision: 14, scale: 2 }),
    estado: text('estado').notNull().default('en_estudio'),
    observaciones: text('observaciones'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'insurance_policy_estado_check',
      sql`${t.estado} IN ('en_estudio', 'aprobada', 'rechazada')`,
    ),
    check(
      'insurance_policy_vigencia_check',
      sql`${t.vigenciaHasta} IS NULL OR ${t.vigenciaDesde} IS NULL
          OR ${t.vigenciaHasta} > ${t.vigenciaDesde}`,
    ),
    index('insurance_policy_tenant_property_idx').on(t.tenantId, t.propertyId),
  ],
);
