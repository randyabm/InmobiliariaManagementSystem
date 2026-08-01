import { check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenant } from './tenant';

/**
 * Recordatorio programado (feature #10, RF-N2, R10).
 *
 * El procesador despacha los `PENDIENTE` con `programada_para <= now()` y
 * los marca `EJECUTADA` (R12). La cancelación es lógica (`CANCELADA`, R11).
 * Los recordatorios específicos (p. ej. inventario sin revisar) los crean
 * sus módulos (#13) sobre esta tabla.
 */
export const notificacionProgramada = pgTable(
  'notificacion_programada',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    programadaPara: timestamp('programada_para', { withTimezone: true }).notNull(),
    estado: text('estado').notNull().default('PENDIENTE'),
    destinatario: text('destinatario').notNull(),
    canal: text('canal').notNull(),
    plantilla: text('plantilla'),
    contenido: jsonb('contenido').notNull().default({}),
    entidadTipo: text('entidad_tipo'),
    entidadId: uuid('entidad_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    ejecutadaEn: timestamp('ejecutada_en', { withTimezone: true }),
  },
  (t) => [
    check(
      'notificacion_programada_estado_check',
      sql`${t.estado} IN ('PENDIENTE', 'EJECUTADA', 'CANCELADA')`,
    ),
    index('notificacion_programada_vencida_idx').on(t.estado, t.programadaPara),
    index('notificacion_programada_tenant_idx').on(t.tenantId),
  ],
);
