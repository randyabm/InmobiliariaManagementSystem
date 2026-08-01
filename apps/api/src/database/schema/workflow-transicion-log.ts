import { boolean, index, jsonb, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenant } from './tenant';
import { workflowInstancia } from './workflow-instancia';
import { workflowTransicion } from './workflow-transicion';
import { workflowEstado } from './workflow-estado';

/**
 * Log de transiciones, append-only (RF-W4, R10). Feature #7.
 *
 * Es el registro de auditoría del dominio: cada transición (humana o
 * automática) escribe una fila con el antes/después y el actor. Los
 * triggers de la migración impiden UPDATE y DELETE (mismo patrón que
 * `audit_log`, `0006`). `contexto_tras` conserva las variables de la
 * instancia como dato de dominio (R16); el `metadata` de `audit_log`
 * queda vacío.
 */
export const workflowTransicionLog = pgTable(
  'workflow_transicion_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    instanciaId: uuid('instancia_id')
      .notNull()
      .references(() => workflowInstancia.id),
    transicionId: uuid('transicion_id').references(() => workflowTransicion.id),
    desdeEstadoId: uuid('desde_estado_id')
      .notNull()
      .references(() => workflowEstado.id),
    haciaEstadoId: uuid('hacia_estado_id')
      .notNull()
      .references(() => workflowEstado.id),
    actorId: uuid('actor_id'),
    automatica: boolean('automatica').notNull().default(false),
    contextoTras: jsonb('contexto_tras').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('workflow_log_instancia_idx').on(t.instanciaId, t.createdAt),
  ],
);
