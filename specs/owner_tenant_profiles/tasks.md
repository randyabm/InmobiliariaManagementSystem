# Tasks — owner_tenant_profiles

> Feature #5. Pasos discretos en orden. Las tasks de test son de primera
> clase, no un apéndice: los invariantes de seguridad (T20–T24) se verifican
> con asserts deterministas contra PostgreSQL real (Testcontainers), nunca con
> juicio de un modelo.
>
> **Prerrequisito:** respuestas a PA-2, PA-5 y PA-7 de `requirements.md` antes
> de escribir T4 (afectan el esquema de la migración).

---

## Bloque 1 — Esquema y migración

- [ ] T1 — Crear `apps/api/src/database/schema/perfil-propietario.ts` con el esquema Drizzle de `perfil_propietario` (campos, CHECKs y las dos UNIQUE de R1). **Cubre: R1.**

- [ ] T2 — Crear `apps/api/src/database/schema/perfil-inquilino.ts` con el esquema Drizzle de `perfil_inquilino` (incluido `medio_preferido_contacto` con su CHECK). **Cubre: R2.**

- [ ] T3 — Crear `apps/api/src/database/schema/cuenta-bancaria.ts` con el esquema Drizzle de `cuenta_bancaria` (`numero_cuenta`, `es_predeterminada`, `activa`). **Cubre: R3.**

- [ ] T4 — Escribir la migración `apps/api/drizzle/0005_owner_tenant_profiles.sql`, forward-only e idempotente: `ALTER TABLE "user" ALTER COLUMN password_hash DROP NOT NULL`, las tres tablas, `ENABLE`+`FORCE ROW LEVEL SECURITY` con política por `tenant_id` en las tres, el índice único parcial de cuenta predeterminada y los índices de consulta. **Cubre: R1, R2, R3, R4, R5, R31.**

- [ ] T5 — Añadir la entrada 5 a `apps/api/drizzle/meta/_journal.json` y exportar los tres esquemas en `apps/api/src/database/schema/index.ts`. **Cubre: R31.**

- [ ] T6 — Añadir `'perfil_propietario'`, `'perfil_inquilino'` y `'cuenta_bancaria'` a `TABLAS_PERMITIDAS` en `tests/migrations.test.ts`. **Cubre: R31.**

- [ ] T7 — Test de migración (`apps/api/test/db/migrations.db.test.ts`): las tres tablas existen, tienen `relrowsecurity` y `relforcerowsecurity` en `true`, y `user.password_hash` es NULL-able. **Cubre: R5, R31.**

- [ ] T8 — Test determinista del índice único parcial: dos cuentas activas `es_predeterminada = true` del mismo propietario provocan violación de unicidad. **Cubre: R4.**

## Bloque 2 — Contexto de tenant (cierre de deuda de #2/#3)

- [ ] T9 — Crear `apps/api/src/common/database/cliente-tenant.ts` con `obtenerClienteTenant(request)` y el error `SinContextoDeTenantError`. **Cubre: R28.**

- [ ] T10 — Modificar `TenantContextInterceptor`: el tenant se resuelve del header `x-tenant-id` validado contra los roles activos del JWT (o el único tenant del JWT si no hay header); cualquier otro caso → 403 sin ejecutar consultas. **Cubre: R27.**

- [ ] T11 — Registrar `TenantContextInterceptor` como `APP_INTERCEPTOR` en `app.module.ts` y ajustar `RolesGuard` para usar el tenant resuelto en vez del header crudo. **Cubre: R26, R27.**

- [ ] T12 — Tests unitarios del interceptor y del guard: header ausente con un solo tenant (ok), header de un tenant sin rol activo (403), header con rol activo (ok). **Cubre: R27.**

## Bloque 3 — Identidad y creación en línea (RF-C6)

- [ ] T13 — Crear `identidad.service.ts` con `crearOVincularIdentidad(cliente, datos, tenantId, rol)`: inserta o reutiliza `user` por email, inserta `user_role`, todo sobre el `PoolClient` recibido. **Cubre: R17, R20.**

- [ ] T14 — Modificar `AuthService.login` para responder 401 cuando `password_hash IS NULL`, sin invocar `bcrypt.compare`. **Cubre: R6.**

- [ ] T15 — Test determinista de R6: usuario creado como propietario (sin credenciales) no puede iniciar sesión con contraseña vacía, nula ni arbitraria → 401 en los tres casos. **Cubre: R6.**

- [ ] T16 — Test de atomicidad (Testcontainers): forzar el fallo del INSERT del perfil y verificar que no quedan filas nuevas en `user` ni en `user_role`. **Cubre: R17.**

- [ ] T17 — Test de reutilización de identidad: email ya existente en el tenant B → se crea solo `user_role` + perfil en el tenant A, y la respuesta no contiene ningún dato del perfil del tenant B. **Cubre: R20.**

## Bloque 4 — Propietarios

- [ ] T18 — Crear DTOs zod (`crear-propietario.dto.ts`, `actualizar-propietario.dto.ts`) y los tipos compartidos en `packages/types/src/clientes.ts`. **Cubre: R7, R10.**

- [ ] T19 — Crear `propietarios.repository.ts` (solo SQL parametrizado sobre el `PoolClient` de la transacción): `insertar`, `buscarPorId`, `buscarPorDocumento`, `actualizar`, `marcarInactivo`. **Cubre: R7, R9, R10, R11, R18, R28.**

- [ ] T20 — Crear `propietarios.service.ts`: `crear` (transacción con `crearOVincularIdentidad`, 409 `PerfilYaExisteError` si el documento ya tiene perfil), `obtener` (hoja de vida + cuentas), `buscarPorDocumento`, `actualizar`, `darDeBaja` (baja lógica). **Cubre: R7, R9, R10, R11, R18, R19.**

- [ ] T21 — Crear `propietarios.controller.ts` con las 5 rutas, `@UseGuards(JwtAuthGuard, RolesGuard)`, `@Roles('admin','empleado')` y `@Audit(...)` en las mutaciones. **Cubre: R7, R9, R10, R11, R18, R26, R29.**

- [ ] T22 — Tests de integración del CRUD de propietario (Testcontainers): creación con datos personales + fiscales, lectura de la hoja de vida, PATCH parcial, y `DELETE` que deja la fila con `activo = false` (verificado con `SELECT`, no por el código de respuesta). **Cubre: R7, R9, R10, R11.**

## Bloque 5 — Cuentas bancarias y punto de extensión hacia #6

- [ ] T23 — Crear `cuentas-bancarias.repository.ts` y `cuentas-bancarias.service.ts` con `crear` (primera cuenta → predeterminada), `listar`, `actualizar` (cambio de predeterminada en una sola transacción) y `resolverCuentaDeGiro`. **Cubre: R8, R12, R21, R22, R23, R24.**

- [ ] T24 — Crear `cuentas-bancarias.controller.ts` con las 3 rutas anidadas bajo `/propietarios/:id`, guards, roles y `@Audit(...)`. **Cubre: R8, R12, R26, R29.**

- [ ] T25 — Tests deterministas de `resolverCuentaDeGiro`: (a) con override válido devuelve el override; (b) sin override devuelve la predeterminada; (c) override de otro propietario → `CuentaDeGiroInvalidaError`; (d) override de otro tenant → `CuentaDeGiroInvalidaError`; (e) sin predeterminada y sin override → `CuentaDeGiroInvalidaError` (nunca `null`). **Cubre: R21, R22, R23, R24.**

- [ ] T26 — Test del cambio de predeterminada: tras el PATCH existe exactamente una cuenta activa con `es_predeterminada = true` para el propietario. **Cubre: R12.**

- [ ] T27 — Documentar en `progress/impl_owner_tenant_profiles.md` la dependencia hacia la feature #6: columna `propiedad.cuenta_bancaria_id`, llamada a `resolverCuentaDeGiro` y test del override vía propiedad. **Cubre: R21 (continuidad), design §6.**

## Bloque 6 — Inquilinos

- [ ] T28 — Crear DTOs zod de inquilino con los campos obligatorios de RF-C4 y el enum `medio_preferido_contacto`. **Cubre: R13, R14.**

- [ ] T29 — Crear `inquilinos.repository.ts` e `inquilinos.service.ts` (mismo patrón que propietarios: creación atómica, 409 por documento repetido, baja lógica). **Cubre: R13, R15, R16, R17, R18, R19, R28.**

- [ ] T30 — Crear `inquilinos.controller.ts` con las 5 rutas, guards, roles y `@Audit(...)`. **Cubre: R13, R15, R16, R18, R26, R29.**

- [ ] T31 — Tests de integración del CRUD de inquilino: creación con los 6 campos, y tabla de casos de rechazo 400 (un campo faltante por caso + `medio_preferido_contacto` inválido) verificando que no se persiste ninguna fila. **Cubre: R13, R14, R15, R16.**

## Bloque 7 — Invariantes de seguridad (tests deterministas, obligatorios)

- [ ] T32 — `apps/api/src/database/__tests__/clientes-rls.test.ts` (Testcontainers, rol sin `BYPASSRLS`, patrón de `audit-log.test.ts`): con `app.current_tenant` = tenant A, un `SELECT *` sin `WHERE` sobre las tres tablas devuelve **solo** filas del tenant A. **Cubre: R5, R25.**

- [ ] T33 — Mismo archivo: sin `SET LOCAL app.current_tenant`, `SELECT` sobre las tres tablas devuelve 0 filas y el repositorio invocado sin `tenantClient` lanza `SinContextoDeTenantError`. **Cubre: R28.**

- [ ] T34 — Test HTTP de aislamiento: token del tenant A pidiendo `GET`, `PATCH` y `DELETE` de un perfil y de una cuenta del tenant B → **404** en los 6 casos (nunca 403 ni 200). **Cubre: R25.**

- [ ] T35 — Test HTTP de RBAC: usuario con único rol activo `propietario` y usuario con único rol activo `inquilino` reciben **403** en los 13 endpoints; sin token, **401**. Asserts por código de estado. **Cubre: R26.**

- [ ] T36 — Test de auditoría: cada una de las 6 mutaciones genera exactamente una fila en `audit_log` con `tenant_id`, `actor_id`, `accion`, `entity_type` y `entity_id` esperados (consultados con `SELECT`). **Cubre: R29.**

- [ ] T37 — Test de datos personales: serializar `metadata` de las filas de `audit_log` generadas y afirmar que el JSON no contiene el `documento`, el `celular`, el `email` ni el `numero_cuenta` usados en el test; ídem para el logger capturado. **Cubre: R30.**

## Bloque 8 — Integración y cierre

- [ ] T38 — Crear `clientes.module.ts` e importarlo desde `core.module.ts`; reexportar los tipos nuevos en `packages/types/src/index.ts`. **Cubre: estructura, R31.**

- [ ] T39 — Ampliar `RUTAS_PERMITIDAS` en `routes-surface.test.ts` con las 13 rutas nuevas. **Cubre: R31.**

- [ ] T40 — Escribir el mapa de trazabilidad `R1..R31 → test concreto` en `progress/impl_owner_tenant_profiles.md`. **Cubre: trazabilidad (`docs/specs.md`).**

- [ ] T41 — Ejecutar `npm run lint`, `npm run typecheck`, `npm run test`, `npm run test:db` y `npm run build`; todo verde. **Verificación final.**

- [ ] T42 — Ejecutar `./init.sh` y verificar exit code 0. **Cierre de sesión.**
