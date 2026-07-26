import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Identidad de una persona en el sistema (feature #3 `auth_rbac`).
 *
 * **Enmendada por la feature #5 (D-5, R6/R7):**
 *
 * - `email` es NULL-able. Hay propietarios reales sin correo y obligarlo
 *   produce datos falsos. Se conserva `unique()`: PostgreSQL trata cada NULL
 *   como distinto, así que varias identidades sin email conviven y dos emails
 *   iguales no nulos siguen colisionando (R7). No hace falta índice parcial.
 * - `password_hash` es NULL-able: un cliente registrado como propietario o
 *   inquilino (RF-C1) todavía no ha activado ningún portal. Contrapartida
 *   obligatoria: `POST /auth/login` responde 401 sin evaluar contraseña
 *   cuando el hash es NULL (R6).
 *
 * Esto supera a `specs/auth_rbac/requirements.md` R1 ("email NOT NULL
 * UNIQUE"); la nota de enmienda está en ese mismo archivo.
 */
export const user = pgTable('user', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').unique(),
  passwordHash: text('password_hash'),
  nombre: text('nombre').notNull(),
  telefono: text('telefono'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
