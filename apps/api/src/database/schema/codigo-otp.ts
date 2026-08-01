import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenant } from './tenant';
import { user } from './user';

/**
 * Código OTP (feature #13, R4, R5, R8).
 *
 * `codigo_hash` es SHA-256 del código de 6 dígitos: el código en claro solo
 * viaja en la notificación (#10, PA-13-3) (R12). `proposito` CHECK
 * (REGISTRO, LOGIN, FIRMA): #14 exigirá un OTP `FIRMA` recién verificado.
 */
export const codigoOtp = pgTable(
  'codigo_otp',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id),
    proposito: text('proposito').notNull(),
    codigoHash: text('codigo_hash').notNull(),
    expiraEn: timestamp('expira_en', { withTimezone: true }).notNull(),
    verificadoEn: timestamp('verificado_en', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'codigo_otp_proposito_check',
      sql`${t.proposito} IN ('REGISTRO', 'LOGIN', 'FIRMA')`,
    ),
    check('codigo_otp_codigo_hash_check', sql`length(${t.codigoHash}) = 64`),
    index('codigo_otp_tenant_user_idx').on(t.tenantId, t.userId, t.proposito),
  ],
);
