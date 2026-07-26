import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { perfilPropietario } from './perfil-propietario';
import { tenant } from './tenant';

/**
 * Cuenta de giro del canon (RF-C5, RF-P1). Feature #5.
 *
 * Un propietario tiene como mucho **una** cuenta activa marcada como
 * predeterminada; lo fuerza un índice único parcial creado en la migración
 * `0005` (R4), no el código de aplicación.
 *
 * El override por propiedad (RF-P1) lo aporta la feature #6 con la columna
 * `propiedad.cuenta_bancaria_id`; aquí solo vive la regla de precedencia
 * (`CuentasBancariasService.resolverCuentaDeGiro`), design.md §6.
 *
 * `numero_cuenta` se guarda en claro: el cifrado en reposo se resuelve a nivel
 * de almacenamiento (NFR §7), no por columna. Nunca se registra en logs ni en
 * `audit_log.metadata` (R36, Ley 1581 de 2012).
 */
export const cuentaBancaria = pgTable(
  'cuenta_bancaria',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    perfilPropietarioId: uuid('perfil_propietario_id')
      .notNull()
      .references(() => perfilPropietario.id),
    banco: text('banco').notNull(),
    tipoCuenta: text('tipo_cuenta').notNull(),
    numeroCuenta: text('numero_cuenta').notNull(),
    titularNombre: text('titular_nombre').notNull(),
    titularTipoDocumento: text('titular_tipo_documento').notNull(),
    titularDocumento: text('titular_documento').notNull(),
    esPredeterminada: boolean('es_predeterminada').notNull().default(false),
    activa: boolean('activa').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'cuenta_bancaria_tipo_cuenta_check',
      sql`${t.tipoCuenta} IN ('AHORROS', 'CORRIENTE')`,
    ),
    check(
      'cuenta_bancaria_titular_tipo_documento_check',
      sql`${t.titularTipoDocumento} IN ('CC', 'CE', 'NIT', 'PASAPORTE')`,
    ),
    index('cuenta_bancaria_tenant_propietario_idx').on(t.tenantId, t.perfilPropietarioId),
  ],
);
