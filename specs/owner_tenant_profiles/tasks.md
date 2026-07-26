# Tasks — owner_tenant_profiles

> Feature #5 — **núcleo**. Pasos discretos en orden. Las tasks de test son de
> primera clase, no un apéndice: los invariantes de seguridad (bloque 7) se
> verifican con asserts deterministas contra PostgreSQL real (Testcontainers),
> nunca con juicio de un modelo.
>
> **v3 — la feature se partió en dos.** Tarifa de retención, codeudores y
> referencias tienen sus propias tasks en
> `specs/retencion_codeudor_referencias/tasks.md` (#25).
>
> Cobertura: R1–R37 en 47 tasks (T1–T47), de las cuales 19 son tasks de test.

---

## Bloque 1 — Esquema y migración

- [x] T1 — Crear `apps/api/src/database/schema/perfil-propietario.ts` con el esquema Drizzle de `perfil_propietario` (campos, CHECKs y las dos UNIQUE), con `sujeto_retencion` y **sin** columna de tarifa (D-2). **Cubre: R1.**

- [x] T2 — Crear `apps/api/src/database/schema/perfil-inquilino.ts` con el esquema Drizzle de `perfil_inquilino` (incluido `medio_preferido_contacto` con su CHECK). **Cubre: R2.**

- [x] T3 — Crear `apps/api/src/database/schema/cuenta-bancaria.ts` con el esquema Drizzle de `cuenta_bancaria`. **Cubre: R3.**

- [x] T4 — Actualizar `apps/api/src/database/schema/user.ts`: `email` y `password_hash` pasan a NULL-able, conservando `unique()` en `email` (D-5). **Cubre: R6, R7.**

- [x] T5 — Escribir la migración `apps/api/drizzle/0005_owner_tenant_profiles.sql`, forward-only e idempotente: `ALTER TABLE "user" ALTER COLUMN password_hash DROP NOT NULL`, `... email DROP NOT NULL` (sin tocar la UNIQUE), las tres tablas nuevas, `ENABLE`+`FORCE ROW LEVEL SECURITY` con política por `tenant_id` en las tres, el índice único parcial de cuenta predeterminada y los índices de consulta. **Cubre: R1, R2, R3, R4, R5, R6, R7, R37.**

- [x] T6 — Añadir la entrada 5 a `apps/api/drizzle/meta/_journal.json` y exportar los tres esquemas en `apps/api/src/database/schema/index.ts`. **Cubre: R37.**

- [x] T7 — Añadir `'perfil_propietario'`, `'perfil_inquilino'` y `'cuenta_bancaria'` a `TABLAS_PERMITIDAS` en `tests/migrations.test.ts`. **Cubre: R37.**

- [x] T8 — Test de migración (`apps/api/test/db/migrations.db.test.ts`): las tres tablas existen con `relrowsecurity` y `relforcerowsecurity` en `true`; `user.email` y `user.password_hash` son NULL-able; `perfil_propietario` tiene `sujeto_retencion` y **no** tiene ninguna columna de tarifa (assert contra `information_schema.columns`). **Cubre: R1, R5, R6, R7, R37.**

- [x] T9 — Test determinista de la unicidad de email tras D-5: dos filas de `user` con `email` NULL se insertan sin error; dos filas con el mismo email no nulo violan la restricción única. **Cubre: R7.**

- [x] T10 — Test determinista del índice único parcial: dos cuentas activas con `es_predeterminada = true` del mismo propietario provocan violación de unicidad. **Cubre: R4.**

## Bloque 2 — Contexto de tenant (deuda de #2/#3 aprobada por el humano)

- [x] T11 — Crear `apps/api/src/common/database/cliente-tenant.ts` con `obtenerClienteTenant(request)` y el error `SinContextoDeTenantError`. **Cubre: R34.**

- [x] T12 — Modificar `TenantContextInterceptor`: el tenant se resuelve del header `x-tenant-id` validado contra los roles activos del JWT (o el único tenant del JWT si no hay header); cualquier otro caso → 403 sin ejecutar consultas. **Cubre: R33.**

- [x] T13 — Registrar `TenantContextInterceptor` como `APP_INTERCEPTOR` en `app.module.ts` y ajustar `RolesGuard` para usar el tenant resuelto en vez del header crudo. **Cubre: R32, R33.**

- [x] T14 — Tests unitarios del interceptor y del guard: header ausente con un solo tenant (ok), header de un tenant sin rol activo (403), header con rol activo (ok). **Cubre: R33.**

## Bloque 3 — Identidad y revisión del login de #3 (D-5)

- [x] T15 — Crear `identidad.service.ts` con `crearOVincularIdentidad(cliente, datos, tenantId, rol)`: vincula por email **solo si el email no es nulo**, inserta `user_role`, todo sobre el `PoolClient` recibido. **Cubre: R22, R25, R26.**

- [x] T16 — Modificar `AuthService.login`: 401 si `password_hash IS NULL` sin invocar `bcrypt.compare`; 401 si el `email` recibido es nulo, ausente o vacío, y la consulta nunca puede casar `email IS NULL`. **Cubre: R6, R8.**

- [x] T17 — Añadir en `specs/auth_rbac/requirements.md` la nota de enmienda que registra que su R1 (`email NOT NULL`) queda superado por R7 de #5, con el motivo (D-5) y la fecha. **Cubre: R7 (coherencia del repositorio), `design.md` §7.2.**

- [x] T18 — Test determinista de R6: un propietario creado sin credenciales no puede iniciar sesión con contraseña vacía, nula ni arbitraria → 401 en los tres casos. **Cubre: R6.**

- [x] T19 — Test determinista de R8: (a) el login por email de un usuario con credenciales sigue devolviendo `access_token`; (b) `email` nulo, ausente y `''` → 401; (c) existiendo un `user` con `email` NULL y `password_hash` NULL, ninguna de esas peticiones lo autentica (verificado también por ausencia de entrada de login en `audit_log`). **Cubre: R8.**

- [x] T20 — Test de atomicidad (Testcontainers): forzar el fallo del INSERT del perfil y verificar que no quedan filas nuevas en `user` ni en `user_role`. **Cubre: R22.**

- [x] T21 — Test de identidad: (a) email ya existente en el tenant B → se crea solo `user_role` + perfil en el tenant A y la respuesta no contiene datos del perfil del tenant B; (b) creación **sin email** de una persona cuyo `documento` ya existe en el tenant B → se crea un `user` nuevo y no se vincula al existente. **Cubre: R25, R26.**

## Bloque 4 — Propietarios

- [x] T22 — Crear DTOs zod (`crear-propietario.dto.ts`, `actualizar-propietario.dto.ts`) con `email` **opcional** (D-5) y los tipos compartidos en `packages/types/src/clientes.ts`. **Cubre: R10, R13.**

- [x] T23 — Crear `propietarios.repository.ts` (solo SQL parametrizado sobre el `PoolClient` de la transacción): `insertar`, `buscarPorId`, `buscarPorDocumento`, `actualizar`, `marcarInactivo`. **Cubre: R10, R12, R13, R14, R23, R34.**

- [x] T24 — Crear `propietarios.service.ts`: `crear` (transacción con `crearOVincularIdentidad`, `PerfilYaExisteError` si el documento ya tiene perfil en el tenant, clave de identidad = tenant + tipo_documento + documento), `obtener` (hoja de vida sin `propiedades` ni certificados), `buscarPorDocumento`, `actualizar`, `darDeBaja`. **Cubre: R9, R10, R12, R13, R14, R16, R17, R23, R24.**

- [x] T25 — Crear `propietarios.controller.ts` con las 5 rutas, `@UseGuards(JwtAuthGuard, RolesGuard)`, `@Roles('admin','empleado')` y `@Audit(...)` en las mutaciones. **Cubre: R10, R12, R13, R14, R23, R32, R35.**

- [x] T26 — Tests de integración del CRUD de propietario (Testcontainers): creación con datos personales y `sujeto_retencion`, creación **sin email** (D-5), lectura de la hoja de vida, PATCH parcial y `DELETE` que deja la fila con `activo = false` (verificado con `SELECT`, no por el código de respuesta). **Cubre: R9, R10, R13, R14, R16.**

- [x] T27 — Test de contrato de `GET /propietarios/:id`: la respuesta **no** contiene las claves `propiedades` ni ninguna de certificados fiscales (D-1, D-3) ni ningún porcentaje de retención (R17, D-2), y sí contiene `sujeto_retencion` y la cuenta predeterminada. **Cubre: R12, R17.**

## Bloque 5 — Cuentas bancarias y punto de extensión hacia #6

- [x] T28 — Crear `cuentas-bancarias.repository.ts` y `cuentas-bancarias.service.ts` con `crear` (primera cuenta → predeterminada), `listar`, `actualizar` (cambio de predeterminada en una sola transacción) y `resolverCuentaDeGiro`. **Cubre: R11, R15, R27, R28, R29, R30.**

- [x] T29 — Crear `cuentas-bancarias.controller.ts` con las 3 rutas anidadas bajo `/propietarios/:id`, guards, roles y `@Audit(...)`. **Cubre: R11, R15, R32, R35.**

- [x] T30 — Tests deterministas de `resolverCuentaDeGiro`: (a) con override válido devuelve el override; (b) sin override devuelve la predeterminada; (c) override de otro propietario → `CuentaDeGiroInvalidaError`; (d) override de otro tenant → `CuentaDeGiroInvalidaError`; (e) sin predeterminada y sin override → `CuentaDeGiroInvalidaError` (nunca `null`). **Cubre: R27, R28, R29, R30.**

- [x] T31 — Test del cambio de predeterminada: tras el PATCH existe exactamente una cuenta activa con `es_predeterminada = true` para el propietario. **Cubre: R15.**

- [x] T32 — Documentar en `progress/impl_owner_tenant_profiles.md` las dependencias hacia otras features: **#6** (columna `propiedad.cuenta_bancaria_id`, llamada a `resolverCuentaDeGiro`, test del override vía propiedad, y la lista de propiedades de RF-C5 diferida por D-1); **#25** (tarifa de retención que consume `sujeto_retencion`, codeudores y referencias); **módulo contable** (certificados, D-3); **portal del cliente** (identificador del token para usuarios sin email, D-5). **Cubre: `design.md` §6, §7.2, §9, §10.**

## Bloque 6 — Inquilinos

- [x] T33 — Crear DTOs zod de inquilino (`email` **obligatorio**, RF-C4) y sus tipos compartidos. **Cubre: R18, R19.**

- [x] T34 — Crear `inquilinos.repository.ts` e `inquilinos.service.ts` (mismo patrón que propietarios: creación atómica, `PerfilYaExisteError` por documento repetido, baja lógica). **Cubre: R18, R20, R21, R22, R23, R24, R34.**

- [x] T35 — Crear `inquilinos.controller.ts` con las 5 rutas, guards, roles y `@Audit(...)`. **Cubre: R18, R20, R21, R23, R32, R35.**

- [x] T36 — Tests de integración del CRUD de inquilino: creación con los 6 campos obligatorios, y tabla de casos de rechazo 400 (un campo faltante por caso + `medio_preferido_contacto` inválido) verificando que no se persiste ninguna fila. **Cubre: R18, R19, R20, R21.**

## Bloque 7 — Invariantes de seguridad (tests deterministas, obligatorios)

- [x] T37 — `apps/api/src/database/__tests__/clientes-rls.test.ts` (Testcontainers, rol sin `BYPASSRLS`, patrón de `audit-log.test.ts`): con `app.current_tenant` = tenant A, un `SELECT *` sin `WHERE` sobre las tres tablas devuelve **solo** filas del tenant A. **Cubre: R5, R31.**

- [x] T38 — Mismo archivo: sin `SET LOCAL app.current_tenant`, `SELECT` sobre las tres tablas devuelve 0 filas, y el repositorio invocado sin `tenantClient` lanza `SinContextoDeTenantError`. **Cubre: R34.**

- [x] T39 — Test HTTP de aislamiento: token del tenant A pidiendo `GET`, `PATCH` y `DELETE` de un perfil de propietario, un perfil de inquilino y una cuenta bancaria del tenant B → **404** en los 9 casos (nunca 403 ni 200). **Cubre: R31.**

- [x] T40 — Test HTTP de RBAC: usuario con único rol activo `propietario` y usuario con único rol activo `inquilino` reciben **403** en las 13 rutas; sin token, **401**. Asserts por código de estado. **Cubre: R32.**

- [x] T41 — Test de auditoría: cada una de las 8 mutaciones genera exactamente una fila en `audit_log` con `tenant_id`, `actor_id`, `accion`, `entity_type` y `entity_id` esperados (consultados con `SELECT`). **Cubre: R35.**

- [x] T42 — Test de datos personales: serializar el `metadata` de las filas de `audit_log` generadas y afirmar que el JSON no contiene el `documento`, el `titular_documento`, el `celular`, el `telefono`, el `email` ni el `numero_cuenta` usados en el test; ídem para el logger capturado. **Cubre: R36.**

## Bloque 8 — Integración y cierre

- [x] T43 — Crear `clientes.module.ts` (3 controllers + servicios + `identidad.service`) e importarlo desde `core.module.ts`; reexportar los tipos nuevos en `packages/types/src/index.ts`. **Cubre: estructura, R37.**

- [x] T44 — Ampliar `RUTAS_PERMITIDAS` en `routes-surface.test.ts` con las 13 rutas nuevas. **Cubre: R37.**

- [x] T45 — Escribir el mapa de trazabilidad `R1..R37 → test concreto` en `progress/impl_owner_tenant_profiles.md`. **Cubre: trazabilidad (`docs/specs.md`).**

- [x] T46 — Ejecutar `npm run lint`, `npm run typecheck`, `npm run test`, `npm run test:db` y `npm run build`; todo verde. **Verificación final.**

- [x] T47 — Ejecutar `./init.sh` y verificar exit code 0. **Cierre de sesión.**
