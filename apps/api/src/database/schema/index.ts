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
 * La tabla `sesion` se creó en la feature #27 `sesion_y_revocacion`, que
 * además añadió `user.token_version` (R2).
 * Las tablas `propiedad`, `propiedad_propietario`, `historial_ocupacion` y
 * `propiedad_documento` se crearon en la feature #6 `property_profile`.
 * Las cinco tablas `workflow_*` se crearon en la feature #7
 * `workflow_engine`, que además sembró la definición `ciclo_vida_propiedad`
 * (R17).
 */
export { tenant } from './tenant';
export { user } from './user';
export { userRole } from './user-role';
export { auditLog } from './audit-log';
export { sesion } from './sesion';
export { perfilPropietario } from './perfil-propietario';
export { perfilInquilino } from './perfil-inquilino';
export { cuentaBancaria } from './cuenta-bancaria';
export { tarifaRetencion } from './tarifa-retencion';
export { codeudorInquilino } from './codeudor-inquilino';
export { referenciaInquilino } from './referencia-inquilino';
export { propiedad } from './propiedad';
export { propiedadPropietario } from './propiedad-propietario';
export { historialOcupacion } from './historial-ocupacion';
export { propiedadDocumento } from './propiedad-documento';
export { workflowDefinicion, TENANT_SISTEMA } from './workflow-definicion';
export { workflowEstado } from './workflow-estado';
export { workflowTransicion } from './workflow-transicion';
export { workflowInstancia } from './workflow-instancia';
export { workflowTransicionLog } from './workflow-transicion-log';
