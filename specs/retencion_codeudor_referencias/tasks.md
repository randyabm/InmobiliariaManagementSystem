# Tasks — retencion_codeudor_referencias

> Feature #25. Pasos discretos en orden. Las tasks de test son de primera clase,
> no un apéndice: los invariantes de seguridad (bloque 4) se verifican con
> asserts deterministas contra PostgreSQL real (Testcontainers), nunca con
> juicio de un modelo.
>
> **Prerrequisito bloqueante:** la feature #5 `owner_tenant_profiles` debe estar
> `done`. Esta feature depende de `perfil_inquilino`,
> `perfil_propietario.sujeto_retencion`, `obtenerClienteTenant`, el
> `TenantContextInterceptor` registrado y el módulo `core/clientes`.
>
> Cobertura: R1–R25 en 27 tasks (T1–T27), de las cuales 11 son tasks de test.

---

## Bloque 1 — Esquema y migración

- [ ] T1 — Crear `apps/api/src/database/schema/tarifa-retencion.ts` con el esquema Drizzle de `tarifa_retencion` (`anio` integer, `porcentaje` numeric(5,2), UNIQUE (`tenant_id`,`anio`)). **Cubre: R1.**

- [ ] T2 — Crear `apps/api/src/database/schema/codeudor-inquilino.ts` con el esquema Drizzle de `codeudor_inquilino` (CHECK de `tipo` y de `tipo_documento`, FK a `perfil_inquilino`, UNIQUE por tenant + inquilino + documento). **Cubre: R2.**

- [ ] T3 — Crear `apps/api/src/database/schema/referencia-inquilino.ts` con el esquema Drizzle de `referencia_inquilino` (`relacion` texto libre nullable, FK a `perfil_inquilino`). **Cubre: R3.**

- [ ] T4 — Escribir la migración con el siguiente índice libre de `apps/api/drizzle/` (previsiblemente `0006_retencion_codeudor_referencias.sql`), forward-only e idempotente: las tres tablas, `ENABLE`+`FORCE ROW LEVEL SECURITY` con política por `tenant_id` en las tres, y los índices de consulta. **No debe añadir ninguna columna a `perfil_propietario`.** **Cubre: R1, R2, R3, R4, R5, R25.**

- [ ] T5 — Añadir la entrada correspondiente a `apps/api/drizzle/meta/_journal.json` y exportar los tres esquemas en `apps/api/src/database/schema/index.ts`. **Cubre: R25.**

- [ ] T6 — Añadir `'tarifa_retencion'`, `'codeudor_inquilino'` y `'referencia_inquilino'` a `TABLAS_PERMITIDAS` en `tests/migrations.test.ts`. **Cubre: R25.**

- [ ] T7 — Test de migración (`apps/api/test/db/migrations.db.test.ts`): las tres tablas existen con `relrowsecurity` y `relforcerowsecurity` en `true`; existe la FK de `codeudor_inquilino` y `referencia_inquilino` hacia `perfil_inquilino`; y `perfil_propietario` **sigue sin** ninguna columna de tarifa o porcentaje (assert contra `information_schema.columns`). **Cubre: R1, R2, R3, R4, R5, R25.**

## Bloque 2 — Tarifa de retención por tenant y año (D-2)

- [ ] T8 — Crear el DTO zod `establecer-tarifa.dto.ts` (`porcentaje` como cadena decimal validada, `anio` como entero de la ruta) y el tipo compartido `TarifaRetencion` en `packages/types/src/clientes.ts`. **Cubre: R6, R11.**

- [ ] T9 — Crear `retencion.repository.ts` y `retencion.service.ts` con `establecer` (upsert por `tenant_id`+`anio`), `listar` (orden `anio` descendente), `resolverPorcentaje` (lanza `TarifaRetencionNoConfiguradaError`) y `resolverRetencionDePropietario` (si `sujeto_retencion = false` devuelve `{ aplica: false }` sin consultar `tarifa_retencion`). Todo sobre el `PoolClient` de la transacción. **Cubre: R6, R7, R8, R9, R10, R11, R22.**

- [ ] T10 — Crear el error `TarifaRetencionNoConfiguradaError` (`TARIFA_RETENCION_NO_CONFIGURADA`, 409) heredando de `AppError`. **Cubre: R9.**

- [ ] T11 — Crear `retencion.controller.ts` con `GET /configuracion/retencion` y `PUT /configuracion/retencion/:anio`, ambos con `@UseGuards(JwtAuthGuard, RolesGuard)` y `@Roles('admin')`, y `@Audit('actualizar','tarifa_retencion')` en el PUT. **Cubre: R6, R7, R21, R23.**

- [ ] T12 — Tests de la tarifa: (a) `PUT` crea y después reemplaza la tarifa del mismo año dejando una sola fila; (b) `GET` devuelve solo las tarifas del tenant de la petición, ordenadas; (c) `resolverPorcentaje` de un año sin configurar lanza `TarifaRetencionNoConfiguradaError` y no devuelve ningún valor por defecto. **Cubre: R6, R7, R8, R9.**

- [ ] T13 — Tests deterministas de precisión y de la marca del perfil: (a) un `porcentaje` como `'3.50'` se devuelve como `'3.50'` exacto, sin pasar por `number`; (b) un propietario con `sujeto_retencion = false` obtiene `{ aplica: false }` y se verifica —con un espía sobre el repositorio— que **no** se consultó `tarifa_retencion`. **Cubre: R10, R11.**

## Bloque 3 — Codeudores y referencias (D-6)

- [ ] T14 — Crear los DTOs zod `crear-codeudor.dto.ts`, `actualizar-codeudor.dto.ts`, `crear-referencia.dto.ts` y `actualizar-referencia.dto.ts`, más los tipos compartidos `CodeudorInquilino`, `TipoCodeudor` y `ReferenciaInquilino`. **Cubre: R12, R15.**

- [ ] T15 — Crear el error `CodeudorYaExisteError` (`CODEUDOR_YA_EXISTE`, 409) heredando de `AppError`. **Cubre: R14.**

- [ ] T16 — Crear `codeudores.repository.ts` y `codeudores.service.ts` con `crear` (409 si el documento ya está registrado para ese inquilino), `listar` (solo activos), `actualizar` y `darDeBaja` (baja lógica). Sobre el `PoolClient` de la transacción. **Cubre: R12, R13, R14, R22.**

- [ ] T17 — Crear `codeudores.controller.ts` con las 4 rutas anidadas bajo `/inquilinos/:id/codeudores`, guards, `@Roles('admin','empleado')` y `@Audit(...)` en las mutaciones. **Cubre: R12, R13, R20, R23.**

- [ ] T18 — Crear `referencias.{repository,service,controller}.ts` con las 4 rutas anidadas bajo `/inquilinos/:id/referencias` (mismo patrón: listar activas, PATCH parcial, DELETE como baja lógica), guards, roles y auditoría. **Cubre: R15, R16, R20, R22, R23.**

- [ ] T19 — Tests de integración de codeudores y referencias: alta, listado (solo activos), PATCH parcial, `DELETE` que deja la fila con `activo = false` verificado con `SELECT`, y 409 `CODEUDOR_YA_EXISTE` al repetir documento en el mismo inquilino. **Cubre: R12, R13, R14, R15, R16.**

- [ ] T20 — Test determinista de la frontera de comportamiento (D-6): se registra un codeudor y una referencia **sin que exista ninguna fila de contrato, firma ni inventario** en la base de datos, y ambas altas responden 201. **Cubre: R17.**

- [ ] T21 — Test determinista de la frontera estructural (D-6): consultar `information_schema.table_constraints` / `key_column_usage` y afirmar que `codeudor_inquilino` y `referencia_inquilino` **no** tienen ninguna FK cuya tabla referenciada sea de contrato, firma, inventario u OTP. **Cubre: R18.**

## Bloque 4 — Invariantes de seguridad (tests deterministas, obligatorios)

- [ ] T22 — `apps/api/src/database/__tests__/retencion-codeudor-rls.test.ts` (Testcontainers, rol sin `BYPASSRLS`, patrón de `clientes-rls.test.ts`): con `app.current_tenant` = tenant A, un `SELECT *` sin `WHERE` sobre las tres tablas devuelve **solo** filas del tenant A; sin `SET LOCAL`, devuelve 0 filas y el repositorio invocado sin `tenantClient` lanza `SinContextoDeTenantError`. **Cubre: R4, R19, R22.**

- [ ] T23 — Test HTTP de aislamiento: token del tenant A pidiendo `GET`, `PATCH` y `DELETE` de un codeudor y de una referencia del tenant B, y `GET`/`PUT` de la tarifa con datos del tenant B → **404** (o la lista del propio tenant, nunca la ajena), sin 403 ni 200 con datos de B. **Cubre: R19.**

- [ ] T24 — Test HTTP de RBAC: usuario con único rol activo `propietario` y usuario con único rol activo `inquilino` reciben **403** en las 10 rutas; un `empleado` recibe **403** en las 2 rutas de `/configuracion/retencion` y **200/201** en las de codeudores y referencias; sin token, **401**. Asserts por código de estado. **Cubre: R20, R21.**

- [ ] T25 — Tests de auditoría y de datos personales: cada una de las 7 mutaciones genera exactamente una fila en `audit_log` con `tenant_id`, `actor_id`, `accion`, `entity_type` y `entity_id` esperados; y el `metadata` serializado no contiene el `documento`, el `celular`, el `telefono` ni el `email` usados en el test (ídem para el logger capturado). **Cubre: R23, R24.**

## Bloque 5 — Integración y cierre

- [ ] T26 — Registrar los 3 controllers y sus servicios en `clientes.module.ts`, reexportar los tipos nuevos, ampliar `RUTAS_PERMITIDAS` en `routes-surface.test.ts` con las 10 rutas (sin tocar las 13 de #5) y escribir el mapa de trazabilidad `R1..R25 → test concreto` en `progress/impl_retencion_codeudor_referencias.md`, incluida la dependencia registrada para #14/#17 (FK codeudor ↔ firmante declarada desde la tabla de firmas). **Cubre: R25, trazabilidad (`docs/specs.md`).**

- [ ] T27 — Ejecutar `npm run lint`, `npm run typecheck`, `npm run test`, `npm run test:db` y `npm run build`; después `./init.sh` con exit code 0. **Verificación final y cierre.**
