import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { perfilInquilino } from './perfil-inquilino';
import { perfilPropietario } from './perfil-propietario';
import { propiedad } from './propiedad';
import { tenant } from './tenant';

/**
 * Contrato de arrendamiento (feature #17, RF-CT3, §8.7).
 *
 * Nace `vigente` al generarse (merge del template); pasa a `firmado`
 * cuando ambas partes firmaron el mismo documento (R3).
 */
export const contract = pgTable(
  'contract',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => propiedad.id),
    inquilinoId: uuid('inquilino_id').references(() => perfilInquilino.id),
    propietarioId: uuid('propietario_id')
      .notNull()
      .references(() => perfilPropietario.id),
    fechaInicio: timestamp('fecha_inicio', { withTimezone: true }).notNull(),
    fechaFin: timestamp('fecha_fin', { withTimezone: true }).notNull(),
    estado: text('estado').notNull().default('vigente'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('contract_estado_check', sql`${t.estado} IN ('vigente', 'firmado')`),
    index('contract_tenant_property_idx').on(t.tenantId, t.propertyId),
  ],
);
