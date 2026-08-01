# Implementación — feature #27 (`sesion_y_revocacion`)

**Status:** implementación completa, a la espera del review. Suite: `npm run
test` **524** (50 archivos) + `npm run test:db` **88** (3 archivos). Lint y
typecheck verdes.

## Mapa de trazabilidad R1–R20 → test concreto

| R | Enunciado (resumen) | Test que lo cubre |
|---|---|---|
| R1 | Tabla `sesion` con RLS ENABLE+FORCE+política | `migrations.db.test.ts` (RLS + política) + `sesiones-rls.test.ts` |
| R2 | `user.token_version` NOT NULL DEFAULT 0 | `migrations.db.test.ts` «user.token_version existe…» |
| R3 | Access token con `jti` y `ver` | `sesiones.api.test.ts` (payload verificado con `jwt.verify`, ver nuevo) + `rol-activo.api.test.ts` |
| R4 | Cada petición valida la sesión contra la base | `sesiones.api.test.ts` (logout → 401, rol revocado → 401) + `sesiones.service.test.ts` (estados) |
| R5 | Token sin `jti`/`ver` → 401 | `sesiones.api.test.ts` «R5 — token sin sesión» |
| R6 | Login crea sesión y entrega refresh | `sesiones.api.test.ts` «login abre una sesión real…» |
| R7 | Refresh rota el token | `sesiones.api.test.ts` «refresh rota: el viejo ya NO» + `sesiones.service.test.ts` «rotar genera uno NUEVO» |
| R8 | Reuso de refresh rotado → revoca sesión | `sesiones.api.test.ts` T17 (SELECT `revocada_at` + auditoría) + `sesiones-rls.test.ts` (huella anterior) |
| R9 | Refresh inexistente/expirado/revocado → un único 401 | `sesiones.api.test.ts` (cuerpos indistinguibles) + `sesiones.service.test.ts` (mismo mensaje) |
| R10 | Refresh solo como hash SHA-256 | `sesiones.api.test.ts` (regex 64 hex + PII) + `migrations.db.test.ts` (índice parcial) + `sesiones.service.test.ts` |
| R11 | Logout revoca en servidor | `sesiones.api.test.ts` (SELECT `revocada_at` + access → 401) |
| R12 | Revocar rol invalida tokens emitidos | `sesiones.api.test.ts` T21 (UPDATE transaccional + 401 + refresh sin el rol) |
| R13 | Acciones de sesión auditadas | `sesiones.api.test.ts` T22 (una fila exacta por acción) + T17 (reuso) |
| R14 | Sesión de A nunca da acceso a B | `sesiones-rls.test.ts` (SELECT* por tenant, id ajeno) + `sesiones.api.test.ts` T19 |
| R15 | RBAC intacto | `sesiones.api.test.ts` T20 + suite completa previa sin cambios en `RolesGuard` |
| R16 | Sin contexto de tenant falla | `sesiones-rls.test.ts` (GUC virgen → 0 filas) + repositorios por cliente de transacción |
| R17 | Tokens/hashes/PII fuera de logs y auditoría | `sesiones.api.test.ts` T23 (stdout/stderr + `to_jsonb(audit_log)`) |
| R18 | `sesion_por_refresh_token` SECURITY DEFINER, sin PUBLIC | `migrations.db.test.ts` (prosecdef, ACL, 5 columnas, coincidencia exacta) + `sesiones-rls.test.ts` (rol de aplicación) |
| R19 | Revalidación dentro del RLS | `auth.service.ts` `refrescar` (buscarPorId en SET LOCAL) + `sesiones-rls.test.ts` |
| R20 | Migración única + TABLAS_PERMITIDAS + RUTAS_PERMITIDAS | `tests/migrations.test.ts` + `routes-surface.test.ts` (+2 rutas) |

**Anclaje al PRD:** R1–R20 citan RF-AU1, RF-C3, RF-AU6, RF-W4, §11.3, D2 y
los criterios de aceptación definidos por el humano al crear la feature
(PA-3). Ningún requirement sin origen.

## Decisiones PA-27 ejecutadas (aprobadas en la puerta del spec)

- **PA-27-1** — tokens sin `jti`/`ver` → 401 (`SESION_INVALIDA`). El arnés
  de tests se adaptó primero (bloque 0): `entorno-clientes.ts` siembra una
  sesión real por usuario con credenciales y firma con `jti`/`ver`;
  `rol-activo.api.test.ts` y `auth-rbac.test.ts` igual.
- **PA-27-2** — la revocación de rol queda como mecanismo probado por test
  (T21: `UPDATE user_role` + `token_version++` en la misma transacción,
  contra PostgreSQL real). Sin endpoint: la administración de roles no tiene
  feature asignada.
- **PA-27-3** — refresh 30 días por defecto (`REFRESH_TOKEN_EXPIRATION`,
  env configurable); access sigue con `JWT_EXPIRATION` (1 h).
- **PA-27-4** — reuso de refresh rotado → revocación completa de la sesión,
  auditada (`auth.sesion_revocada_por_reuso`).

## Desviaciones anotadas (todas en el spec o menores)

1. **El login responde 201, no 200** (R6): el endpoint ya respondía 201
   antes de esta feature y `login-tras-d5.test.ts` lo fija. El spec se
   corrigió en el mismo cambio.
2. **La validación de sesión resuelve el tenant como el interceptor** (R33),
   no de `roles[0]`: `JwtStrategy` usa `passReqToCallback` y
   `resolverTenantOpcional`. Sin esto, `tokenConRolAjeno` con header válido
   (invariante R33/R35 de la #5) habría pasado de 201 a 401. Los tres tests
   de `seguridad.api.test.ts` que lo ejercitan siguen verdes.
3. **`sesion_por_refresh_token` también casa la huella anterior**
   (`refresh_token_hash_anterior`): es lo que permite detectar el reuso
   (R8) desde la misma función. Documentado en el `COMMENT ON FUNCTION`.
4. **Ejecución por dependencias, no literal:** la migración (bloque 1) se
   implementó antes que el arnés (bloque 0) porque el arnés inserta en
   `sesion`. Las tasks del spec no cambian; solo el orden de corrida.
5. **`rol-aplicacion.ts` ampliado** (archivo de #3/#5): GRANT de
   `sesion_por_refresh_token` al rol de aplicación, junto al de
   `tenant_por_codigo`.

## Candidatas a mutación (para el reviewer)

1. Quitar el `WHERE refresh_token_hash IS NOT NULL` — no; mejor: **devolver
   sesión aunque `revocada_at` no sea NULL** en `validarAcceso` del
   repositorio → rompe logout/401.
2. **Quitar el chequeo de `ver`** en `SesionesService.validarAcceso` →
   rompe T21 (rol revocado → 401).
3. **`rotarRefresh` sin mover el hash a `..._anterior`** → rompe T17 (reuso
   no detectado) y el test de rotación.
4. **`refrescar` sin revocar la sesión en el reuso** (solo 401) → rompe T17
   (SELECT `revocada_at` + auditoría).
5. **`JwtStrategy` sin `passReqToCallback`** (tenant = roles[0]) → rompe los
   3 tests R33/R35 de `seguridad.api.test.ts`.
6. **Quitar las políticas RLS de la migración 0011** → rompe
   `sesiones-rls.test.ts` (SELECT* → 0 filas).
7. **Login sin `jti` en el payload** → rompe `sesiones.api.test.ts` (401 en
   la siguiente petición).
