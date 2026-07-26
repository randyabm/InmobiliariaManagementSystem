/**
 * Esquema de Drizzle.
 *
 * La primera tabla de negocio (`tenant`) se creó en la feature #2
 * `multitenancy_rls`, junto con su RLS (docs/conventions.md).
 * Las tablas `user` y `user_role` se crearon en la feature #3
 * `auth_rbac`.
 * La tabla `audit_log` se creó en la feature #4 `auditoria`.
 */
export { tenant } from './tenant';
export { user } from './user';
export { userRole } from './user-role';
export { auditLog } from './audit-log';
