import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenant } from './tenant';
import { user } from './user';

/**
 * Hoja de vida del inquilino (RF-C4, RF-C1). Feature #5.
 *
 * A diferencia del propietario, el email **sí** es obligatorio para el
 * inquilino (RF-C4 lo exige de forma explícita); la opcionalidad de D-5 aplica
 * solo al propietario. El email vive en `user`, así que la obligatoriedad se
 * valida en el DTO, no con una columna aquí.
 *
 * Codeudores, coarrendatarios y referencias son alcance de la feature #25
 * (D-6): esta feature no crea sus tablas.
 */
export const perfilInquilino = pgTable(
  'perfil_inquilino',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id),
    tipoDocumento: text('tipo_documento').notNull(),
    documento: text('documento').notNull(),
    celular: text('celular').notNull(),
    medioPreferidoContacto: text('medio_preferido_contacto').notNull(),
    activo: boolean('activo').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('perfil_inquilino_tenant_user_key').on(t.tenantId, t.userId),
    unique('perfil_inquilino_tenant_documento_key').on(
      t.tenantId,
      t.tipoDocumento,
      t.documento,
    ),
    check(
      'perfil_inquilino_tipo_documento_check',
      sql`${t.tipoDocumento} IN ('CC', 'CE', 'NIT', 'PASAPORTE')`,
    ),
    check(
      'perfil_inquilino_medio_contacto_check',
      sql`${t.medioPreferidoContacto} IN ('CORREO', 'SMS', 'WHATSAPP', 'LLAMADA')`,
    ),
    index('perfil_inquilino_tenant_documento_idx').on(t.tenantId, t.documento),
  ],
);
