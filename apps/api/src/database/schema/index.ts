/**
 * Esquema de Drizzle.
 *
 * La primera tabla de negocio (`tenant`) se creó en la feature #2
 * `multitenancy_rls`, junto con su RLS (docs/conventions.md).
 * Las tablas `user` y `user_role` se crearon en la feature #3
 * `auth_rbac`.
 * La tabla `audit_log` se creó en la feature #4 `auditoria`.
 * Las tablas `perfil_propietario`, `perfil_inquilino` y `cuenta_bancaria` se
 * crearon en la feature #5 `owner_tenant_profiles`, que además relajó
 * `user.email` y `user.password_hash` a NULL-able (D-5).
 * Las tablas `tarifa_retencion`, `codeudor_inquilino` y `referencia_inquilino`
 * se crearon en la feature #25 `retencion_codeudor_referencias`.
 */
export { tenant } from './tenant';
export { user } from './user';
export { userRole } from './user-role';
export { auditLog } from './audit-log';
export { perfilPropietario } from './perfil-propietario';
export { perfilInquilino } from './perfil-inquilino';
export { cuentaBancaria } from './cuenta-bancaria';
export { tarifaRetencion } from './tarifa-retencion';
export { codeudorInquilino } from './codeudor-inquilino';
export { referenciaInquilino } from './referencia-inquilino';
