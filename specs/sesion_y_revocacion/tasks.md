# Tasks — sesion_y_revocacion

> Feature #27. Pasos discretos en orden. Las tasks de test son de primera
> clase, no un apéndice: los invariantes de seguridad (bloque 4) se verifican
> con asserts deterministas contra PostgreSQL real (Testcontainers), nunca con
> juicio de un modelo.
>
> **Prerrequisitos:** #26 `done` (claim `rol_activo` y `POST /auth/rol-activo`
> son el punto de extensión), #5 `done` (contexto de tenant, auditoría), #3
> `done` (login, guards).
>
> **Bloque 0 primero (arnés):** `JwtStrategy` pasa a exigir `jti`/`ver` (R5);
> si el arnés no emite tokens reales, la suite entera cae. El arnés se
> adapta ANTES de tocar el strategy y queda verde.
>
> Cobertura: R1–R20 en 28 tasks (T1–T28), de las cuales 12 son tasks de test.

---

## Bloque 0 — Arné de tests: sesiones reales en los tokens (PA-27-1)

- [ ] T1 — En `apps/api/test/support/entorno-clientes.ts`, sembrar una
  `sesion` por usuario con credenciales y firmar sus tokens con `jti` (id de
  la sesión) y `ver` (`token_version` del usuario, que se puede insertar
  directo en la semilla). Los usuarios sin credenciales NO reciben sesión.
  Correr `npm run test` y dejar la suite verde. **Cubre: R3, R4, R5 (base).**

- [ ] T2 — Adaptar `rol-activo.api.test.ts` (función local `firmar` y token
  `falsificado`) y `auth-rbac.test.ts` (tokens firmados a mano) para incluir
  `jti`/`ver` y sembrar la sesión correspondiente; verificar que los casos
  que deben seguir pasando pasan y que el token `falsificado` sigue
  representando exactamente el ataque que el test dice probar. **Cubre:
  R3, R4, R5 (base), R15.**

## Bloque 1 — Esquema y migración

- [ ] T3 — Crear `apps/api/src/database/schema/sesion.ts` con el esquema
  Drizzle de `sesion` (FK a `user` y `tenant`, hash vigente y anterior,
  `expira_en`, `revocada_at`, `motivo_revocacion`, `last_used_at`). **Cubre:
  R1, R10.**

- [ ] T4 — Añadir `tokenVersion` al esquema de `user.ts` (`integer NOT NULL
  DEFAULT 0`) y exportar `sesion` en `schema/index.ts`. **Cubre: R2.**

- [ ] T5 — Escribir la migración con el siguiente índice libre de
  `apps/api/drizzle/` (`0011_sesion_y_revocacion.sql`), forward-only e
  idempotente: tabla `sesion` con su UNIQUE parcial sobre
  `refresh_token_hash`, índice `(user_id, tenant_id)`, CHECK de coherencia
  de la revocación, `token_version` en `user`, `ENABLE`+`FORCE RLS` con
  política por `tenant_id` en `sesion`, y la función
  `sesion_por_refresh_token` `SECURITY DEFINER` con `REVOKE ALL FROM
  PUBLIC`. **Cubre: R1, R2, R10, R18, R20.**

- [ ] T6 — Añadir la entrada a `apps/api/drizzle/meta/_journal.json` y
  `'sesion'` a `TABLAS_PERMITIDAS` en `tests/migrations.test.ts`. **Cubre:
  R20.**

- [ ] T7 — Test de migración (`apps/api/test/db/migrations.db.test.ts`):
  `sesion` existe con `relrowsecurity` y `relforcerowsecurity` en `true` y su
  política filtra por `app.current_tenant`; `user.token_version` existe con
  default 0; el índice único parcial de `refresh_token_hash` existe; la
  función `sesion_por_refresh_token` existe, es `SECURITY DEFINER`, no está
  concedida a PUBLIC y devuelve exactamente las 5 columnas del bootstrap;
  no hay ninguna OTRA función `SECURITY DEFINER` nueva. **Cubre: R1, R2,
  R10, R18, R20.**

## Bloque 2 — Validación por petición (R4, R5)

- [ ] T8 — Crear `sesiones.repository.ts`: `validarAcceso(jti, ver, tenantId)`
  que, sobre el cliente de la transacción con contexto, une `sesion` con
  `user` y devuelve el estado (o `null`); `crear`, `rotarRefresh`,
  `revocar`, `marcarReuso`. Sin contexto de tenant → `SinContextoDeTenantError`
  (nada de pool crudo). **Cubre: R4, R16.**

- [ ] T9 — Crear `sesiones.service.ts` con `validarAcceso` (traduce el estado
  a `SesionInvalidaError` 401 uniforme), `abrirSesion` (genera refresh,
  guarda hash), `rotar` (R7), `revocar` (R11) y `detectarReuso` (R8). **Cubre:
  R4, R5, R6, R7, R8, R9, R11.**

- [ ] T10 — Crear el error `SesionInvalidaError` (`SESION_INVALIDA`, 401)
  heredando de `AppError`, con un solo mensaje para todos los fallos. **Cubre:
  R4, R9.**

- [ ] T11 — Hacer `JwtStrategy.validate` async: exige `jti`/`ver` (401 si
  faltan) y delega en `SesionesService.validarAcceso` dentro de una
  transacción con `SET LOCAL` del `tenant_id` del token. `RolesGuard` NO se
  toca. Correr la suite completa y dejarla verde (el arnés del bloque 0 ya
  emite tokens reales). **Cubre: R4, R5, R15, R16.**

## Bloque 3 — Login, refresh y logout

- [ ] T12 — `auth.service.ts`: el login autenticado crea la sesión, firma el
  access token con `jti`/`ver`, genera el refresh token y responde
  `{ access_token, refresh_token, expires_in, user }`. El refresh token solo
  existe en la respuesta; su hash, en la base. **Cubre: R3, R6, R10.**

- [ ] T13 — `auth.controller.ts`: `POST /auth/refresh` (público, sin guard)
  que valida el hash, resuelve el tenant por `sesion_por_refresh_token`
  (R18), revalida dentro del RLS (R19), rota (R7), detecta reuso (R8) y
  responde 401 uniforme (R9). **Cubre: R7, R8, R9, R18, R19.**

- [ ] T14 — `auth.controller.ts`: `POST /auth/logout` con `JwtAuthGuard` que
  revoca la sesión del `jti` en el servidor (R11). **Cubre: R11.**

- [ ] T15 — Ampliar `RUTAS_PERMITIDAS` en `routes-surface.test.ts` con
  `POST /auth/refresh` y `POST /auth/logout` (sin tocar las existentes) y
  registrar `SesionesRepository`/`SesionesService` en `auth.module.ts`.
  **Cubre: R20.**

- [ ] T16 — Tests de integración del ciclo de vida (Testcontainers + app
  real): login abre sesión y devuelve los tres datos; con el access token se
  accede; refresh rota (el refresh viejo NO vuelve a servir y emite un access
  nuevo con `ver` actual); logout revoca y la siguiente petición con el
  access es 401 (verificado con SELECT de `revocada_at`); refresh de una
  sesión revocada o expirada → 401. **Cubre: R6, R7, R9, R11.**

- [ ] T17 — Test de reuso: usar un refresh, guardar el viejo, rotar una vez
  y reenviar el viejo → 401 y la sesión queda `revocada_at` (SELECT
  independiente). **Cubre: R8, R13.**

## Bloque 4 — Invariantes de seguridad (tests deterministas, obligatorios)

- [ ] T18 — `apps/api/src/database/__tests__/sesiones-rls.test.ts`
  (Testcontainers, rol sin `BYPASSRLS`, patrón de `clientes-rls.test.ts`):
  `SELECT *` sin `WHERE` sobre `sesion` devuelve solo las sesiones del
  tenant activo; pedir por id una sesión ajena devuelve 0 filas; en conexión
  virgen devuelve 0 filas; y `sesion_por_refresh_token` devuelve la sesión
  correcta SOLO por coincidencia exacta de hash (no por substrings ni
  prefijos). **Cubre: R1, R14, R16, R18.**

- [ ] T19 — Test HTTP de la frontera R14: refresh token emitido en el tenant
  A usado en `POST /auth/refresh` nunca abre contexto del tenant B (la
  rotación ocurre en el tenant de la sesión, verificado con SELECT); un
  access token de A sigue sin poder tocar recursos de B (regresión, 404).
  **Cubre: R14.**

- [ ] T20 — Test HTTP de RBAC: la validación de sesión NO sustituye al
  RBAC — un `propietario` con sesión válida sigue recibiendo 403 en rutas
  `admin` y 401 sin token; y un token válido pero sin rol sigue siendo
  rechazado (R15). **Cubre: R15.**

- [ ] T21 — Test determinista de la aceptación: revocar un rol con
  `UPDATE user_role SET activo = false` + `UPDATE "user" SET token_version =
  token_version + 1` en la misma transacción (poolAdmin) y demostrar que la
  siguiente petición con el access token **ya emitido** es 401; y que tras
  un refresh legítimo el access nuevo ya no lleva el rol revocado y las
  rutas de ese rol devuelven 403. **Cubre: R12.**

- [ ] T22 — Tests de auditoría: cada acción de R13 genera exactamente una
  fila en `audit_log` con `tenant_id`, `actor_id`, `accion`, `entity_type =
  'sesion'`, `entity_id` y, en las revocaciones, motivo y timestamp; y el
  `metadata` serializado no contiene el refresh token, su hash ni PII (ídem
  para el logger capturado). **Cubre: R13, R17.**

- [ ] T23 — Test de PII en el cuerpo y logs: el refresh token en claro
  (valor distintivo de test) no aparece en la respuesta de refresh, ni en
  logs, ni en la base (solo su hash, verificado con SELECT), ni en
  `audit_log`. **Cubre: R10, R17.**

## Bloque 5 — Integración y cierre

- [ ] T24 — Test unitario de `sesiones.service.ts` con doble de repositorio
  que registra SQL: `validarAcceso` exige `jti`/`ver` y devuelve
  `SesionInvalidaError` para cada estado (no encontrada, revocada, expirada,
  versión vieja) con el MISMO mensaje; `rotar` mueve el hash vigente al
  campo anterior; `detectarReuso` compara contra el hash anterior. **Cubre:
  R4, R5, R7, R8, R9.**

- [ ] T25 — Actualizar `docs/architecture.md` (o la sección de
  autenticación que corresponda) con el flujo de validación por petición y
  la función SECURITY DEFINER como segunda vía fuera del RLS; actualizar la
  lista blanca de funciones si existe. **Cubre: R18, gobernanza.**

- [ ] T26 — Revisar `tests/ddl-en-tests.test.ts`: ningún test crea la tabla
  `sesion` ni la función; la suite anti-DDL sigue verde. **Cubre:
  gobernanza (C3).**

- [ ] T27 — Escribir el mapa de trazabilidad `R1..R20 → test concreto` en
  `progress/impl_sesion_y_revocacion.md`, incluidas las decisiones PA-27-1…
  PA-27-4 ejecutadas. **Cubre: trazabilidad (`docs/specs.md`).**

- [ ] T28 — Ejecutar `npm run lint`, `npm run typecheck`, `npm run test`,
  `npm run test:db` y `npm run build`; después `./init.sh` con exit code 0.
  **Verificación final y cierre.**
