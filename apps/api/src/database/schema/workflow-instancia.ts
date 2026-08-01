import { boolean, index, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { tenant } from './tenant';
import { workflowDefinicion } from './workflow-definicion';
import { workflowEstado } from './workflow-estado';

/**
 * Instancia de un workflow sobre una entidad (RF-W1, R6, R12). Feature #7.
 *
 * `entidad_tipo`/`entidad_id` son opacos para el motor (la validación de
 * existencia es del módulo de negocio, #8); la UNIQUE garantiza una sola
 * máquina de una definición por entidad (R12). `contexto` son las
 * variables de la instancia sobre las que se evalúan las condiciones (R3).
 */
export const workflowInstancia = pgTable(
  'workflow_instancia',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    definicionId: uuid('definicion_id')
      .notNull()
      .references(() => workflowDefinicion.id),
    entidadTipo: text('entidad_tipo').notNull(),
    entidadId: uuid('entidad_id').notNull(),
    estadoActualId: uuid('estado_actual_id')
      .notNull()
      .references(() => workflowEstado.id),
    contexto: jsonb('contexto').notNull().default({}),
    activo: boolean('activo').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('workflow_instancia_definicion_entidad_key').on(
      t.definicionId,
      t.entidadTipo,
      t.entidadId,
    ),
    index('workflow_instancia_tenant_idx').on(t.tenantId),
  ],
);
