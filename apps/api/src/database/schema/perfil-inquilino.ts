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
 * solo al propietario.
 *
 * **Contacto en el perfil (D-9, R69).** Desde D-9 ese correo es
 * `email_contacto`, una columna `NOT NULL` de esta tabla, y no `user.email`:
 * la obligatoriedad de RF-C4 la impone ahora **el motor** y no solo el DTO.
 * No se añade `telefono_contacto`: `celular` ya estaba y hace de teléfono de
 * contacto (R69).
 *
 * Con `email_contacto`, `celular` y `medio_preferido_contacto` en la misma
 * fila, el motor de notificaciones (RF-N1, feature #10) resuelve destinatario y
 * canal **sin leer `user`** (**R72**).
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
    emailContacto: text('email_contacto').notNull(),
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
