import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { workflowDefinicion } from './workflow-definicion';
import { workflowEstado } from './workflow-estado';

/**
 * Transición de un workflow (RF-W1, RF-W5). Feature #7.
 *
 * `tipo_ejecucion`: `HUMANA` (la dispara un actor con alguno de
 * `roles_requeridos`, R7) o `AUTOMATICA` (se dispara en cascada al entrar
 * al estado origen, R8). `condicion` son cláusulas JSONB evaluadas por un
 * evaluador whitelisted sobre el contexto (R3). `notificacion` es el hook
 * declarativo de la feature #10: aquí es solo dato.
 */
export const workflowTransicion = pgTable(
  'workflow_transicion',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    definicionId: uuid('definicion_id')
      .notNull()
      .references(() => workflowDefinicion.id),
    origenEstadoId: uuid('origen_estado_id')
      .notNull()
      .references(() => workflowEstado.id),
    destinoEstadoId: uuid('destino_estado_id')
      .notNull()
      .references(() => workflowEstado.id),
    clave: text('clave').notNull(),
    tipoEjecucion: text('tipo_ejecucion').notNull(),
    rolesRequeridos: text('roles_requeridos').array().notNull().default(sql`'{}'::text[]`),
    condicion: jsonb('condicion').notNull().default(sql`'[]'::jsonb`),
    notificacion: jsonb('notificacion').notNull().default(sql`'{}'::jsonb`),
    orden: integer('orden').notNull().default(0),
    activo: boolean('activo').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('workflow_transicion_definicion_origen_clave_key').on(
      t.definicionId,
      t.origenEstadoId,
      t.clave,
    ),
    check(
      'workflow_transicion_tipo_ejecucion_check',
      sql`${t.tipoEjecucion} IN ('HUMANA', 'AUTOMATICA')`,
    ),
    index('workflow_transicion_origen_idx').on(t.definicionId, t.origenEstadoId),
  ],
);
