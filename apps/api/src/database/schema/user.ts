import { pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { tenant } from './tenant';

/**
 * Identidad de una persona en el sistema (feature #3 `auth_rbac`).
 *
 * **Enmendada por la feature #5 (D-5, R6/R7):**
 *
 * - `email` es NULL-able. Hay propietarios reales sin correo y obligarlo
 *   produce datos falsos.
 * - `password_hash` es NULL-able: un cliente registrado como propietario o
 *   inquilino (RF-C1) todavía no ha activado ningún portal. Contrapartida
 *   obligatoria: `POST /auth/login` responde 401 sin evaluar contraseña
 *   cuando el hash es NULL (R6).
 *
 * **Enmendada otra vez por D-8 (R59, R60):** `user` deja de ser una tabla
 * global y pasa a ser una **tabla de negocio normal, con `tenant_id`**. Las
 * identidades nunca se comparten entre inmobiliarias: cada una tiene su propia
 * fila para una misma persona física. De ahí salen tres cambios:
 *
 * 1. `tenant_id NOT NULL` con FK a `tenant`, y la **política RLS estándar** del
 *    proyecto (`USING` + `WITH CHECK` sobre `tenant_id`) en lugar de la
 *    `FOR ALL` retorcida que tenía y que rompía la creación de identidades en
 *    cuanto el rol dejase de ser superusuario (hallazgo B4).
 * 2. La unicidad del correo pasa de global a `UNIQUE (tenant_id, email)`. Los
 *    NULL siguen conviviendo: PostgreSQL trata cada NULL como distinto, así
 *    que D-5 y R7 se mantienen sin índice parcial.
 * 3. `UNIQUE (id, tenant_id)`, que existe solo para que `user_role` pueda
 *    apuntar a ella con una FK compuesta y sea **imposible** que un rol viva en
 *    un tenant distinto al de su identidad (R60).
 *
 * **`email` es credencial, no contacto (D-9, R71).** El correo y el teléfono de
 * contacto de un cliente viven en su perfil; en un cliente recién registrado
 * esta columna queda NULL.
 *
 * Esto supera a `specs/auth_rbac/requirements.md` R1 ("email NOT NULL UNIQUE");
 * las notas de enmienda están en ese mismo archivo.
 */
export const user = pgTable(
  'user',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    email: text('email'),
    passwordHash: text('password_hash'),
    nombre: text('nombre').notNull(),
    telefono: text('telefono'),
    /**
     * Documento de la persona (**R5** de la #26, migración `0009`).
     *
     * Es la clave por la que se **deduplica la identidad dentro de la
     * inmobiliaria** desde que D-9 vació `user.email` para los clientes. NULL
     * en empleados y administradores, que se dan de alta sin documento: por eso
     * el índice único de **R6** es **parcial** (`WHERE documento IS NOT NULL`) y
     * vive en la migración, no aquí.
     *
     * Sigue sin ser único de forma global: **D-8** prohíbe reconocer a la misma
     * persona **entre** inmobiliarias.
     */
    tipoDocumento: text('tipo_documento'),
    documento: text('documento'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (tabla) => ({
    tenantEmailKey: unique('user_tenant_email_key').on(tabla.tenantId, tabla.email),
    idTenantKey: unique('user_id_tenant_key').on(tabla.id, tabla.tenantId),
  }),
);
