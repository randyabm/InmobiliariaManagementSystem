import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Inmobiliaria (feature #2).
 *
 * **`codigo` lo añade la feature #5 (D-12, R73–R77):** identificador corto y
 * legible (`arrendamientos-sion`) con el que el usuario indica en qué
 * inmobiliaria entra al iniciar sesión, ahora que el correo ya no es único
 * global (D-8). Su formato es el de una **etiqueta DNS válida** a propósito:
 * el mismo valor servirá de subdominio en RF-INT2/RF-INT3 sin rehacer el login.
 *
 * El `CHECK` de formato y la lista de códigos reservados viven en la migración
 * `0007_identidad_por_tenant.sql`, no aquí: son la barrera real y tienen que
 * valer también para un alta hecha a mano contra la base (R77, PA-14).
 *
 * El `nit` **no desaparece**: sigue siendo el dato fiscal de la inmobiliaria;
 * simplemente dejó de ser candidato a identificador de acceso (D-12).
 */
export const tenant = pgTable('tenant', {
  id: uuid('id').primaryKey().defaultRandom(),
  nombre: text('nombre').notNull(),
  nit: text('nit').notNull().unique(),
  codigo: text('codigo').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
