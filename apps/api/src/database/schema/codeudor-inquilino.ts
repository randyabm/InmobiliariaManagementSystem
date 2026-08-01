import { boolean, check, index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { perfilInquilino } from './perfil-inquilino';
import { tenant } from './tenant';

/**
 * Codeudor / coarrendatario del inquilino (RF-C4, D-6). Feature #25.
 *
 * Es **captura de datos** de la hoja de vida del inquilino: no exige contrato
 * ni firma (R17) y no declara ninguna FK hacia entidades de contrato, firma,
 * inventario u OTP (R18). El amarre codeudor ↔ firmante lo añadirán las
 * features #14/#17 declarando la FK **desde** la tabla de firmas, no al revés.
 *
 * El documento se repite dentro del tenant si el mismo codeudor acompaña a dos
 * inquilinos, pero nunca dentro del mismo inquilino: lo fuerza la UNIQUE
 * (R2). La unicidad es **dentro del tenant** (D-7 heredado de #5): una
 * unicidad global permitiría descubrir por colisión que una persona ya figura
 * en otra inmobiliaria (§11.3).
 *
 * Un codeudor **no es una identidad del sistema**: no se le crea `user` ni
 * `user_role` (design.md §9). Su email y celular son datos de contacto de un
 * tercero (Ley 1581 de 2012: minimización); nunca llegan a logs ni a
 * `audit_log.metadata` (R24).
 */
export const codeudorInquilino = pgTable(
  'codeudor_inquilino',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    perfilInquilinoId: uuid('perfil_inquilino_id')
      .notNull()
      .references(() => perfilInquilino.id),
    tipo: text('tipo').notNull(),
    nombre: text('nombre').notNull(),
    tipoDocumento: text('tipo_documento').notNull(),
    documento: text('documento').notNull(),
    email: text('email'),
    celular: text('celular'),
    activo: boolean('activo').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('codeudor_inquilino_tenant_inquilino_documento_key').on(
      t.tenantId,
      t.perfilInquilinoId,
      t.tipoDocumento,
      t.documento,
    ),
    check('codeudor_inquilino_tipo_check', sql`${t.tipo} IN ('CODEUDOR', 'COARRENDATARIO')`),
    check(
      'codeudor_inquilino_tipo_documento_check',
      sql`${t.tipoDocumento} IN ('CC', 'CE', 'NIT', 'PASAPORTE')`,
    ),
    index('codeudor_inquilino_tenant_inquilino_idx').on(t.tenantId, t.perfilInquilinoId),
  ],
);
