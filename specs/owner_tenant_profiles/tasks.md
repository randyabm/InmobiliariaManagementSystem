# Tasks — owner_tenant_profiles

> Feature #5. Pasos discretos en orden. Las tasks de test son de primera
> clase, no un apéndice: los invariantes de seguridad (bloque 8) se verifican
> con asserts deterministas contra PostgreSQL real (Testcontainers), nunca con
> juicio de un modelo.
>
> **v2 — alineada con las decisiones D-1 … D-7** (`requirements.md`). Ya no hay
> preguntas abiertas que bloqueen el arranque.
> Cobertura: R1–R44 en 55 tasks (T1–T55), de las cuales 21 son tasks de test.

---

## Bloque 1 — Esquema y migración

- [ ] T1 — Crear `apps/api/src/database/schema/perfil-propietario.ts` con el esquema Drizzle de `perfil_propietario` (campos, CHECKs y las dos UNIQUE). **Sin** columna `porcentaje_retencion` (D-2). **Cubre: R1.**

- [ ] T2 — Crear `apps/api/src/database/schema/perfil-inquilino.ts` con el esquema Drizzle de `perfil_inquilino` (incluido `medio_preferido_contacto` con su CHECK). **Cubre: R2.**

- [ ] T3 — Crear `apps/api/src/database/schema/cuenta-bancaria.ts` con el esquema Drizzle de `cuenta_bancaria`. **Cubre: R3.**

- [ ] T4 — Crear `apps/api/src/database/schema/codeudor-inquilino.ts` y `referencia-inquilino.ts` (D-6). **Cubre: R5, R6.**

- [ ] T5 — Crear `apps/api/src/database/schema/tarifa-retencion.ts` con `anio` integer, `porcentaje` numeric(5,2) y UNIQUE (`tenant_id`,`anio`) (D-2). **Cubre: R7.**

- [ ] T6 — Actualizar `apps/api/src/database/schema/user.ts`: `email` y `password_hash` pasan a NULL-able, conservando `unique()` en `email` (D-5). **Cubre: R9, R10.**

- [ ] T7 — Escribir la migración `apps/api/drizzle/0005_owner_tenant_profiles.sql`, forward-only e idempotente: `ALTER TABLE "user" ALTER COLUMN password_hash DROP NOT NULL`, `... email DROP NOT NULL` (sin tocar la UNIQUE), las seis tablas nuevas, `ENABLE`+`FORCE ROW LEVEL SECURITY` con política por `tenant_id` en las seis, el índice único parcial de cuenta predeterminada y los índices de consulta. **Cubre: R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R44.**

- [ ] T8 — Añadir la entrada 5 a `apps/api/drizzle/meta/_journal.json` y exportar los seis esquemas en `apps/api/src/database/schema/index.ts`. **Cubre: R44.**

- [ ] T9 — Añadir las seis tablas nuevas a `TABLAS_PERMITIDAS` en `tests/migrations.test.ts`. **Cubre: R44.**

- [ ] T10 — Test de migración (`apps/api/test/db/migrations.db.test.ts`): las seis tablas existen con `relrowsecurity` y `relforcerowsecurity` en `true`; `user.email` y `user.password_hash` son NULL-able; `perfil_propietario` **no** tiene columna `porcentaje_retencion` (assert contra `information_schema.columns`). **Cubre: R1, R8, R9, R10, R44.**

- [ ] T11 — Test determinista de la unicidad de email tras D-5: dos filas de `user` con `email` NULL se insertan sin error; dos filas con el mismo email no nulo violan la restricción única. **Cubre: R10.**

- [ ] T12 — Test determinista del índice único parcial: dos cuentas activas con `es_predeterminada = true` del mismo propietario provocan violación de unicidad. **Cubre: R4.**

## Bloque 2 — Contexto de tenant (deuda de #2/#3 aprobada por el humano)

- [ ] T13 — Crear `apps/api/src/common/database/cliente-tenant.ts` con `obtenerClienteTenant(request)` y el error `SinContextoDeTenantError`. **Cubre: R41.**

- [ ] T14 — Modificar `TenantContextInterceptor`: el tenant se resuelve del header `x-tenant-id` validado contra los roles activos del JWT (o el único tenant del JWT si no hay header); cualquier otro caso → 403 sin ejecutar consultas. **Cubre: R40.**

- [ ] T15 — Registrar `TenantContextInterceptor` como `APP_INTERCEPTOR` en `app.module.ts` y ajustar `RolesGuard` para usar el tenant resuelto en vez del header crudo. **Cubre: R39, R40.**

- [ ] T16 — Tests unitarios del interceptor y del guard: header ausente con un solo tenant (ok), header de un tenant sin rol activo (403), header con rol activo (ok). **Cubre: R40.**

## Bloque 3 — Identidad y revisión del login de #3 (D-5)

- [ ] T17 — Crear `identidad.service.ts` con `crearOVincularIdentidad(cliente, datos, tenantId, rol)`: vincula por email **solo si el email no es nulo**, inserta `user_role`, todo sobre el `PoolClient` recibido. **Cubre: R29, R32, R33.**

- [ ] T18 — Modificar `AuthService.login`: 401 si `password_hash IS NULL` sin invocar `bcrypt.compare`; 401 si el `email` recibido es nulo, ausente o vacío, y la consulta nunca puede casar `email IS NULL`. **Cubre: R9, R11.**

- [ ] T19 — Añadir en `specs/auth_rbac/requirements.md` la nota de enmienda que registra que su R1 (`email NOT NULL`) queda superado por R10 de #5, con el motivo (D-5) y la fecha. **Cubre: R10 (coherencia del repositorio), `design.md` §7.2.**

- [ ] T20 — Test determinista de R9: un propietario creado sin credenciales no puede iniciar sesión con contraseña vacía, nula ni arbitraria → 401 en los tres casos. **Cubre: R9.**

- [ ] T21 — Test determinista de R11: (a) el login por email de un usuario con credenciales sigue devolviendo `access_token`; (b) `email` nulo, ausente y `''` → 401; (c) existiendo un `user` con `email` NULL y `password_hash` NULL, ninguna de esas peticiones lo autentica (verificado también por ausencia de entrada de login en `audit_log`). **Cubre: R11.**

- [ ] T22 — Test de atomicidad (Testcontainers): forzar el fallo del INSERT del perfil y verificar que no quedan filas nuevas en `user` ni en `user_role`. **Cubre: R29.**

- [ ] T23 — Test de identidad: (a) email ya existente en el tenant B → se crea solo `user_role` + perfil en el tenant A y la respuesta no contiene datos del perfil del tenant B; (b) creación **sin email** de una persona cuyo `documento` ya existe en el tenant B → se crea un `user` nuevo y no se vincula al existente. **Cubre: R32, R33.**

## Bloque 4 — Propietarios

- [ ] T24 — Crear DTOs zod (`crear-propietario.dto.ts`, `actualizar-propietario.dto.ts`) con `email` **opcional** (D-5) y los tipos compartidos en `packages/types/src/clientes.ts`. **Cubre: R13, R16.**

- [ ] T25 — Crear `propietarios.repository.ts` (solo SQL parametrizado sobre el `PoolClient` de la transacción): `insertar`, `buscarPorId`, `buscarPorDocumento`, `actualizar`, `marcarInactivo`. **Cubre: R13, R15, R16, R17, R30, R41.**

- [ ] T26 — Crear `propietarios.service.ts`: `crear` (transacción con `crearOVincularIdentidad`, `PerfilYaExisteError` si el documento ya tiene perfil en el tenant, clave de identidad = tenant + tipo_documento + documento), `obtener` (hoja de vida sin `propiedades` ni certificados), `buscarPorDocumento`, `actualizar`, `darDeBaja`. **Cubre: R12, R13, R15, R16, R17, R19, R30, R31.**

- [ ] T27 — Crear `propietarios.controller.ts` con las 5 rutas, `@UseGuards(JwtAuthGuard, RolesGuard)`, `@Roles('admin','empleado')` y `@Audit(...)` en las mutaciones. **Cubre: R13, R15, R16, R17, R30, R39, R42.**

- [ ] T28 — Tests de integración del CRUD de propietario (Testcontainers): creación con datos personales + fiscales, creación **sin email** (D-5), lectura de la hoja de vida, PATCH parcial y `DELETE` que deja la fila con `activo = false` (verificado con `SELECT`, no por el código de respuesta). **Cubre: R12, R13, R16, R17, R19.**

- [ ] T29 — Test de contrato de `GET /propietarios/:id`: la respuesta **no** contiene las claves `propiedades` ni ninguna de certificados fiscales (D-1, D-3), y sí contiene `sujeto_retencion` y la cuenta predeterminada. **Cubre: R15.**

## Bloque 5 — Retención en la fuente como configuración del tenant (D-2)

- [ ] T30 — Crear `retencion.repository.ts` y `retencion.service.ts` con `establecer(anio, porcentaje)` (upsert por `tenant_id`+`anio`), `listar()` y `resolverPorcentaje(anio)` que lanza `TarifaRetencionNoConfiguradaError`. `porcentaje` viaja como `string` para no perder precisión. **Cubre: R20, R21.**

- [ ] T31 — Crear `retencion.controller.ts` con `GET /configuracion/retencion` y `PUT /configuracion/retencion/:anio`, ambos con `@Roles('admin')` y auditoría en el PUT. **Cubre: R20, R39, R42.**

- [ ] T32 — Tests de la tarifa: (a) `PUT` crea y luego reemplaza la tarifa del año; (b) `GET` devuelve solo las tarifas del tenant de la petición; (c) `resolverPorcentaje` de un año sin configurar lanza `TarifaRetencionNoConfiguradaError`; (d) la tarifa del tenant A no es visible ni resoluble desde el tenant B; (e) `empleado` recibe 403 en ambos endpoints. **Cubre: R20, R21, R38, R39.**

## Bloque 6 — Cuentas bancarias y punto de extensión hacia #6

- [ ] T33 — Crear `cuentas-bancarias.repository.ts` y `cuentas-bancarias.service.ts` con `crear` (primera cuenta → predeterminada), `listar`, `actualizar` (cambio de predeterminada en una sola transacción) y `resolverCuentaDeGiro`. **Cubre: R14, R18, R34, R35, R36, R37.**

- [ ] T34 — Crear `cuentas-bancarias.controller.ts` con las 3 rutas anidadas bajo `/propietarios/:id`, guards, roles y `@Audit(...)`. **Cubre: R14, R18, R39, R42.**

- [ ] T35 — Tests deterministas de `resolverCuentaDeGiro`: (a) con override válido devuelve el override; (b) sin override devuelve la predeterminada; (c) override de otro propietario → `CuentaDeGiroInvalidaError`; (d) override de otro tenant → `CuentaDeGiroInvalidaError`; (e) sin predeterminada y sin override → `CuentaDeGiroInvalidaError` (nunca `null`). **Cubre: R34, R35, R36, R37.**

- [ ] T36 — Test del cambio de predeterminada: tras el PATCH existe exactamente una cuenta activa con `es_predeterminada = true` para el propietario. **Cubre: R18.**

- [ ] T37 — Documentar en `progress/impl_owner_tenant_profiles.md` las dependencias hacia otras features: #6 (columna `propiedad.cuenta_bancaria_id`, llamada a `resolverCuentaDeGiro`, test del override vía propiedad, y la lista de propiedades de RF-C5 diferida por D-1); módulo contable (certificados, D-3); #14/#17 (amarre codeudor ↔ firma, D-6); portal del cliente (identificador del token para usuarios sin email, D-5). **Cubre: `design.md` §6, §7.2, §9, §10.**

## Bloque 7 — Inquilinos, codeudores y referencias

- [ ] T38 — Crear DTOs zod de inquilino (email **obligatorio**, RF-C4), de codeudor y de referencia, más sus tipos compartidos. **Cubre: R22, R23, R26, R27.**

- [ ] T39 — Crear `inquilinos.repository.ts` e `inquilinos.service.ts` (mismo patrón que propietarios: creación atómica, `PerfilYaExisteError` por documento repetido, baja lógica). **Cubre: R22, R24, R25, R29, R30, R31, R41.**

- [ ] T40 — Crear `inquilinos.controller.ts` con las 5 rutas, guards, roles y `@Audit(...)`. **Cubre: R22, R24, R25, R30, R39, R42.**

- [ ] T41 — Crear `codeudores.{repository,service,controller}.ts` con las 4 rutas anidadas bajo `/inquilinos/:id/codeudores` (POST, GET, PATCH, DELETE con baja lógica), guards, roles y auditoría. **Cubre: R26, R28, R39, R42.**

- [ ] T42 — Crear `referencias.{repository,service,controller}.ts` con las 4 rutas anidadas bajo `/inquilinos/:id/referencias`, guards, roles y auditoría. **Cubre: R27, R28, R39, R42.**

- [ ] T43 — Tests de integración del CRUD de inquilino: creación con los 6 campos obligatorios, y tabla de casos de rechazo 400 (un campo faltante por caso + `medio_preferido_contacto` inválido) verificando que no se persiste ninguna fila. **Cubre: R22, R23, R24, R25.**

- [ ] T44 — Tests de codeudores y referencias: alta, listado, PATCH y baja lógica; alta de un codeudor y de una referencia **sin que exista ningún contrato ni firma** en la base de datos; y assert de que `codeudor_inquilino` y `referencia_inquilino` no tienen FK hacia entidades de contrato/firma (consulta a `information_schema.table_constraints`). **Cubre: R26, R27, R28.**

## Bloque 8 — Invariantes de seguridad (tests deterministas, obligatorios)

- [ ] T45 — `apps/api/src/database/__tests__/clientes-rls.test.ts` (Testcontainers, rol sin `BYPASSRLS`, patrón de `audit-log.test.ts`): con `app.current_tenant` = tenant A, un `SELECT *` sin `WHERE` sobre las seis tablas devuelve **solo** filas del tenant A. **Cubre: R8, R38.**

- [ ] T46 — Mismo archivo: sin `SET LOCAL app.current_tenant`, `SELECT` sobre las seis tablas devuelve 0 filas, y el repositorio invocado sin `tenantClient` lanza `SinContextoDeTenantError`. **Cubre: R41.**

- [ ] T47 — Test HTTP de aislamiento: token del tenant A pidiendo `GET`, `PATCH` y `DELETE` de un perfil de propietario, un perfil de inquilino, una cuenta bancaria, un codeudor, una referencia y una tarifa del tenant B → **404** en todos los casos (nunca 403 ni 200). **Cubre: R38.**

- [ ] T48 — Test HTTP de RBAC: usuario con único rol activo `propietario` y usuario con único rol activo `inquilino` reciben **403** en las 23 rutas; `empleado` recibe 403 en las 2 de `/configuracion/retencion`; sin token, **401**. Asserts por código de estado. **Cubre: R39.**

- [ ] T49 — Test de auditoría: cada una de las 13 mutaciones genera exactamente una fila en `audit_log` con `tenant_id`, `actor_id`, `accion`, `entity_type` y `entity_id` esperados (consultados con `SELECT`). **Cubre: R42.**

- [ ] T50 — Test de datos personales: serializar el `metadata` de las filas de `audit_log` generadas y afirmar que el JSON no contiene el `documento`, el `titular_documento`, el `celular`, el `telefono`, el `email` ni el `numero_cuenta` usados en el test; ídem para el logger capturado. **Cubre: R43.**

## Bloque 9 — Integración y cierre

- [ ] T51 — Crear `clientes.module.ts` (6 controllers + servicios + `identidad.service`) e importarlo desde `core.module.ts`; reexportar los tipos nuevos en `packages/types/src/index.ts`. **Cubre: estructura, R44.**

- [ ] T52 — Ampliar `RUTAS_PERMITIDAS` en `routes-surface.test.ts` con las 23 rutas nuevas. **Cubre: R44.**

- [ ] T53 — Escribir el mapa de trazabilidad `R1..R44 → test concreto` en `progress/impl_owner_tenant_profiles.md`. **Cubre: trazabilidad (`docs/specs.md`).**

- [ ] T54 — Ejecutar `npm run lint`, `npm run typecheck`, `npm run test`, `npm run test:db` y `npm run build`; todo verde. **Verificación final.**

- [ ] T55 — Ejecutar `./init.sh` y verificar exit code 0. **Cierre de sesión.**
