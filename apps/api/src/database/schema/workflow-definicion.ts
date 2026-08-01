import { boolean, check, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenant } from './tenant';

/**
 * Definición de un workflow (RF-W1, D3). Feature #7.
 *
 * Estados y transiciones viven en filas (`workflow_estado` y
 * `workflow_transicion`): ninguna lógica de negocio puede hardcodear una
 * máquina de estados (RF-A4).
 *
 * Las plantillas del sistema (`origen = 'SISTEMA'`) usan el `tenant_id`
 * reservado `00000000-0000-0000-0000-000000000000`; la política RLS las
 * hace legibles por cualquier tenant pero escribe solo desde el contexto
 * propio (PA-7-1, R13).
 */
export const workflowDefinicion = pgTable(
  'workflow_definicion',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    nombre: text('nombre').notNull(),
    tipo: text('tipo').notNull(),
    origen: text('origen').notNull(),
    version: integer('version').notNull().default(1),
    activo: boolean('activo').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('workflow_definicion_tenant_tipo_key').on(t.tenantId, t.tipo),
    check(
      'workflow_definicion_origen_check',
      sql`${t.origen} IN ('SISTEMA', 'TENANT')`,
    ),
  ],
);

/** El tenant reservado de las plantillas del sistema (PA-7-1, R13). */
export const TENANT_SISTEMA = '00000000-0000-0000-0000-000000000000';
