import { boolean, index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { workflowDefinicion } from './workflow-definicion';

/**
 * Estado de un workflow (RF-W1). Feature #7.
 *
 * `clave` es el identificador estable del estado dentro de la definición
 * (p. ej. `disponible`); `es_inicial`/`es_final` marcan los bordes de la
 * máquina; `orden` es la presentación. La instancia apunta al estado
 * actual por id.
 */
export const workflowEstado = pgTable(
  'workflow_estado',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    definicionId: uuid('definicion_id')
      .notNull()
      .references(() => workflowDefinicion.id),
    clave: text('clave').notNull(),
    etiqueta: text('etiqueta').notNull(),
    esInicial: boolean('es_inicial').notNull().default(false),
    esFinal: boolean('es_final').notNull().default(false),
    orden: integer('orden').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('workflow_estado_definicion_clave_key').on(t.definicionId, t.clave),
    index('workflow_estado_definicion_idx').on(t.definicionId),
  ],
);
