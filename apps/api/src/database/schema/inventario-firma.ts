import { check, index, pgTable, text, timestamp, uuid, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { inventario } from './inventario';
import { tenant } from './tenant';
import { user } from './user';

/**
 * Firma electrónica del inventario (feature #14, R3, §design 4).
 *
 * Append-only: los triggers de la migración impiden UPDATE/DELETE incluso
 * al dueño. Una firma por parte (UNIQUE inventario+firmante). La evidencia
 * completa vive aquí (IP, timestamp, hash, OTP); nunca en `audit_log` ni
 * en logs (R10).
 */
export const inventarioFirma = pgTable(
  'inventario_firma',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    inventarioId: uuid('inventario_id')
      .notNull()
      .references(() => inventario.id),
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
      'inventario_firma_firmante_tipo_check',
      sql`${t.firmanteTipo} IN ('EMPLEADO', 'INQUILINO')`,
    ),
    check('inventario_firma_hash_check', sql`length(${t.hashDocumento}) = 64`),
    index('inventario_firma_tenant_inventario_idx').on(t.tenantId, t.inventarioId),
    uniqueIndex('inventario_firma_inventario_firmante_unique_idx')
      .on(t.inventarioId, t.firmanteTipo),
  ],
);
