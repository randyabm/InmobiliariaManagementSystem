import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { cuentaBancaria } from './cuenta-bancaria';
import { perfilInquilino } from './perfil-inquilino';
import { perfilPropietario } from './perfil-propietario';
import { tenant } from './tenant';

/**
 * Hoja de vida del inmueble (RF-P1). Feature #6.
 *
 * Los cuatro grupos de datos del PRD viven en una sola fila: identificación
 * (dirección, tipo, área, matrícula, estrato, parqueaderos/depósitos,
 * fotos), comercial (canon, administración, incremento pactado),
 * administración PH y contable (cuenta de giro con override).
 *
 * **Fronteras deliberadas:** no lleva `estado` (ciclo de vida = #8) ni
 * columnas de retención (la tarifa es del tenant/año, #25 R5). El
 * `propietario_principal_id` es contra quien se resuelve la cuenta de giro
 * (R8, dependencia #5); los propietarios adicionales viven en
 * `propiedad_propietario` (R2).
 *
 * `fotos` son claves de object storage, nunca binarios (R17).
 */
export const propiedad = pgTable(
  'propiedad',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    direccion: text('direccion').notNull(),
    tipo: text('tipo').notNull(),
    area: numeric('area', { precision: 10, scale: 2 }).notNull(),
    matriculaInmobiliaria: text('matricula_inmobiliaria'),
    estrato: integer('estrato'),
    parqueaderos: integer('parqueaderos').notNull().default(0),
    depositos: integer('depositos').notNull().default(0),
    fotos: text('fotos')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    canon: numeric('canon', { precision: 12, scale: 2 }).notNull(),
    valorAdministracion: numeric('valor_administracion', {
      precision: 12,
      scale: 2,
    }),
    canonIncluyeAdministracion: boolean('canon_incluye_administracion')
      .notNull()
      .default(false),
    incrementoAnualPactado: numeric('incremento_anual_pactado', {
      precision: 5,
      scale: 2,
    }),
    nombreConjunto: text('nombre_conjunto'),
    contactoAdminNombre: text('contacto_admin_nombre'),
    contactoAdminTelefono: text('contacto_admin_telefono'),
    contactoAdminCorreo: text('contacto_admin_correo'),
    propietarioPrincipalId: uuid('propietario_principal_id')
      .notNull()
      .references(() => perfilPropietario.id),
    cuentaBancariaId: uuid('cuenta_bancaria_id').references(() => cuentaBancaria.id),
    inquilinoActualId: uuid('inquilino_actual_id').references(() => perfilInquilino.id),
    activo: boolean('activo').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'propiedad_tipo_check',
      sql`${t.tipo} IN ('APARTAMENTO', 'CASA', 'LOCAL', 'OFICINA', 'BODEGA', 'PARQUEADERO')`,
    ),
    check('propiedad_estrato_check', sql`${t.estrato} BETWEEN 1 AND 6`),
    check('propiedad_area_check', sql`${t.area} > 0`),
    check('propiedad_canon_check', sql`${t.canon} >= 0`),
    index('propiedad_tenant_idx').on(t.tenantId),
    index('propiedad_principal_idx').on(t.tenantId, t.propietarioPrincipalId),
  ],
);
