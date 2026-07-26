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
 * Hoja de vida del propietario (RF-C5, RF-C1). Feature #5.
 *
 * Los datos de contacto (`nombre`, `email`, `telefono`) NO se duplican aquí:
 * viven en `user` (feature #3). Este perfil es la relación entre esa identidad
 * y una inmobiliaria concreta.
 *
 * `documento` vive en el perfil y es único **dentro** del tenant (D-7,
 * design.md §7.1): una unicidad global permitiría descubrir por colisión que
 * una persona ya es cliente de otra inmobiliaria (PRD §11.3).
 *
 * `sujeto_retencion` es solo la marca booleana. La **tarifa** es configuración
 * del tenant por año y es alcance de la feature #25 (D-2): esta tabla no tiene
 * ninguna columna de porcentaje.
 */
export const perfilPropietario = pgTable(
  'perfil_propietario',
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
    direccionNotificacion: text('direccion_notificacion'),
    ciudad: text('ciudad'),
    sujetoRetencion: boolean('sujeto_retencion').notNull().default(false),
    activo: boolean('activo').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('perfil_propietario_tenant_user_key').on(t.tenantId, t.userId),
    unique('perfil_propietario_tenant_documento_key').on(
      t.tenantId,
      t.tipoDocumento,
      t.documento,
    ),
    check(
      'perfil_propietario_tipo_documento_check',
      sql`${t.tipoDocumento} IN ('CC', 'CE', 'NIT', 'PASAPORTE')`,
    ),
    index('perfil_propietario_tenant_documento_idx').on(t.tenantId, t.documento),
  ],
);
