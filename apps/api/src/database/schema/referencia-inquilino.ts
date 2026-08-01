import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { perfilInquilino } from './perfil-inquilino';
import { tenant } from './tenant';

/**
 * Referencia personal del inquilino (RF-C4, D-6). Feature #25.
 *
 * `relacion` es texto libre y nullable: el PRD no define una taxonomía de
 * referencias y no se inventa una (R3).
 *
 * Mismas fronteras que `codeudor_inquilino`: captura de datos sin exigencias de
 * contrato o firma (R17), sin FK hacia contrato, firma, inventario u OTP
 * (R18), y la persona no es una identidad del sistema (design.md §9). Sus
 * datos no llegan a logs ni a `audit_log.metadata` (R24).
 */
export const referenciaInquilino = pgTable(
  'referencia_inquilino',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    perfilInquilinoId: uuid('perfil_inquilino_id')
      .notNull()
      .references(() => perfilInquilino.id),
    nombre: text('nombre').notNull(),
    telefono: text('telefono').notNull(),
    relacion: text('relacion'),
    email: text('email'),
    activo: boolean('activo').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('referencia_inquilino_tenant_inquilino_idx').on(t.tenantId, t.perfilInquilinoId),
  ],
);
