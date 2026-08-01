import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenant } from './tenant';
import { user } from './user';

/**
 * Sesión de acceso de una identidad (RF-AU1, PA-3). Feature #27.
 *
 * ## Por qué existe
 *
 * El JWT es un dato firmado pero **viejo**: nada puede invalidarlo salvo un
 * estado vivo consultado en cada petición. La sesión es ese estado: su `id`
 * es el claim `jti` del access token, y revocar la sesión (`revocada_at`)
 * hace que la siguiente petición con ese token sea 401 (R4, R11). El
 * `user.token_version` (ver claim) hace lo propio cuando se revoca un rol
 * (R12): una versión vieja en el token = 401.
 *
 * ## Refresh tokens (R10)
 *
 * En la base **solo viven hashes SHA-256** del refresh token: el vigente
 * (`refresh_token_hash`) y el que se rotó (`refresh_token_hash_anterior`).
 * La huella del rotado existe para detectar **reuso** (R8): si alguien
 * reenvía un refresh que ya se rotó, la sesión completa se revoca.
 *
 * La sesión es de **una** inmobiliaria (tenant_id): un token o refresh de A
 * nunca abre contexto en B (R14). RLS habilitado y forzado desde la
 * migración (R1).
 */
export const sesion = pgTable(
  'sesion',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    refreshTokenHash: text('refresh_token_hash'),
    refreshTokenHashAnterior: text('refresh_token_hash_anterior'),
    expiraEn: timestamp('expira_en', { withTimezone: true }).notNull(),
    revocadaAt: timestamp('revocada_at', { withTimezone: true }),
    motivoRevocacion: text('motivo_revocacion'),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('sesion_refresh_token_hash_key').on(t.refreshTokenHash),
    index('sesion_tenant_user_idx').on(t.tenantId, t.userId),
    check(
      'sesion_revocacion_coherente_check',
      sql`(${t.revocadaAt} IS NULL) = (${t.motivoRevocacion} IS NULL)`,
    ),
  ],
);
