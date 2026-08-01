import { boolean, index, pgTable, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { perfilPropietario } from './perfil-propietario';
import { propiedad } from './propiedad';
import { tenant } from './tenant';

/**
 * Propietarios adicionales de la propiedad (RF-P2, R2). Feature #6.
 *
 * El **principal** vive en `propiedad.propietario_principal_id` (contra
 * quien se resuelve la cuenta de giro, R8); aquí viven los demás, sin
 * ambigüedad de giro (PA-6-2). La UNIQUE evita asociar dos veces al mismo
 * perfil; la baja es lógica (`activo = false`).
 */
export const propiedadPropietario = pgTable(
  'propiedad_propietario',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    propiedadId: uuid('propiedad_id')
      .notNull()
      .references(() => propiedad.id),
    perfilPropietarioId: uuid('perfil_propietario_id')
      .notNull()
      .references(() => perfilPropietario.id),
    activo: boolean('activo').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('propiedad_propietario_unico_key').on(t.propiedadId, t.perfilPropietarioId),
    index('propiedad_propietario_tenant_idx').on(t.tenantId, t.propiedadId),
  ],
);
