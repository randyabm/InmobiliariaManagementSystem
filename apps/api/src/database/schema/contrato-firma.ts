import { check, index, pgTable, text, timestamp, uuid, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { contract } from './contract';
import { tenant } from './tenant';
import { user } from './user';

/**
 * Firma del contrato (feature #17, R3, Ley 527). Append-only (triggers en
 * la migración), una firma por parte (UNIQUE contract+firmante).
 */
export const contratoFirma = pgTable(
  'contrato_firma',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    contractId: uuid('contract_id')
      .notNull()
      .references(() => contract.id),
    firmanteTipo: text('firmante_tipo').notNull(),
    firmanteUserId: uuid('firmante_user_id')
      .notNull()
      .references(() => user.id),
    hashDocumento: text('hash_documento').notNull(),
    ip: text('ip').notNull(),
    otpVerificadoEn: timestamp('otp_verificado_en', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'contrato_firma_firmante_tipo_check',
      sql`${t.firmanteTipo} IN ('EMPLEADO', 'INQUILINO')`,
    ),
    check('contrato_firma_hash_check', sql`length(${t.hashDocumento}) = 64`),
    uniqueIndex('contrato_firma_contract_firmante_unique_idx').on(
      t.contractId,
      t.firmanteTipo,
    ),
    index('contrato_firma_tenant_contract_idx').on(t.tenantId, t.contractId),
  ],
);
