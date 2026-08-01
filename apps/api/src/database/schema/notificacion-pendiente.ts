import { check, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenant } from './tenant';

/**
 * Outbox de notificaciones (feature #10, R1).
 *
 * La fila se escribe en la MISMA transacción que la transición del
 * workflow (R2, PA-10-4): si la transición revierte, la notificación
 * también. El procesador la despacha después (R3) y guarda aquí el
 * resultado; `intentos` acota los reintentos (R4).
 */
export const notificacionPendiente = pgTable(
  'notificacion_pendiente',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    canal: text('canal'),
    destinatario: text('destinatario'),
    plantilla: text('plantilla'),
    contenido: jsonb('contenido').notNull().default({}),
    entidadTipo: text('entidad_tipo'),
    entidadId: uuid('entidad_id'),
    transicionId: uuid('transicion_id'),
    estado: text('estado').notNull().default('PENDIENTE'),
    intentos: integer('intentos').notNull().default(0),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    procesadaEn: timestamp('procesada_en', { withTimezone: true }),
  },
  (t) => [
    check(
      'notificacion_pendiente_estado_check',
      sql`${t.estado} IN ('PENDIENTE', 'PROCESADA', 'FALLIDA')`,
    ),
    index('notificacion_pendiente_estado_idx').on(t.estado, t.createdAt),
    index('notificacion_pendiente_tenant_idx').on(t.tenantId),
  ],
);
