import { boolean, check, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenant } from './tenant';

/**
 * Plantilla de inmueble (feature #11, R1).
 *
 * El catálogo base (`origen = 'SISTEMA'`) usa el tenant reservado
 * `00000000-0000-0000-0000-000000000000`; la política RLS las hace legibles
 * por cualquier tenant pero escribe solo desde el contexto propio (patrón
 * de `workflow_definicion`, #7, PA-11-1). El tenant clona y personaliza
 * (`origen = 'TENANT'`), una plantilla por `tipo`.
 */
export const plantillaInmueble = pgTable(
  'plantilla_inmueble',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    tipo: text('tipo').notNull(),
    nombre: text('nombre').notNull(),
    origen: text('origen').notNull(),
    version: integer('version').notNull().default(1),
    activo: boolean('activo').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('plantilla_inmueble_tenant_tipo_key').on(t.tenantId, t.tipo),
    check(
      'plantilla_inmueble_tipo_check',
      sql`${t.tipo} IN ('APARTAMENTO', 'CASA', 'LOCAL', 'OFICINA', 'BODEGA', 'PARQUEADERO')`,
    ),
    check('plantilla_inmueble_origen_check', sql`${t.origen} IN ('SISTEMA', 'TENANT')`),
  ],
);

/** El tenant reservado del catálogo base (PA-11-1). */
export const TENANT_SISTEMA_PLANTILLAS = '00000000-0000-0000-0000-000000000000';
