import { boolean, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { tenant } from './tenant';
import { user } from './user';

export const userRole = pgTable(
  'user_role',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    rol: text('rol').notNull(),
    activo: boolean('activo').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('user_role_user_tenant_rol_key').on(t.userId, t.tenantId, t.rol)],
);
