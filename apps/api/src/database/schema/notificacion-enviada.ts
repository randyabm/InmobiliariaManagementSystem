import { check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenant } from './tenant';

/**
 * Registro inmutable de notificaciones entregadas (feature #10, R6).
 *
 * Append-only (triggers en la migración, patrón `audit_log`): la historia
 * de lo enviado no se muta ni se borra (RF-W4). El `contenido` vive aquí
 * como dato de dominio; nunca en logs ni en `audit_log.metadata` (R15).
 */
export const notificacionEnviada = pgTable(
  'notificacion_enviada',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    canal: text('canal').notNull(),
    destinatario: text('destinatario').notNull(),
    entidadTipo: text('entidad_tipo'),
    entidadId: uuid('entidad_id'),
    plantilla: text('plantilla'),
    contenido: jsonb('contenido').notNull().default({}),
    estado: text('estado').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'notificacion_enviada_estado_check',
      sql`${t.estado} IN ('PROCESADA', 'FALLIDA')`,
    ),
    index('notificacion_enviada_tenant_created_idx').on(t.tenantId, t.createdAt),
  ],
);
