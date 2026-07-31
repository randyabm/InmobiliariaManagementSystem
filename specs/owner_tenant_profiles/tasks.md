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

- [x] T15 — Crear `identidad.service.ts` con `crearOVincularIdentidad(cliente, datos, tenantId, rol)`: vincula por email **solo si el email no es nulo**, inserta `user_role`, todo sobre el `PoolClient` recibido. **Cubre: R22, R25, R26.** ⚠️ *R25 quedó eliminado por D-8: la vinculación por email que esta task construyó la **retira** T58.*

- [x] T16 — Modificar `AuthService.login`: 401 si `password_hash IS NULL` sin invocar `bcrypt.compare`; 401 si el `email` recibido es nulo, ausente o vacío, y la consulta nunca puede casar `email IS NULL`. **Cubre: R6, R8.**

- [x] T17 — Añadir en `specs/auth_rbac/requirements.md` la nota de enmienda que registra que su R1 (`email NOT NULL`) queda superado por R7 de #5, con el motivo (D-5) y la fecha. **Cubre: R7 (coherencia del repositorio), `design.md` §7.2.**

- [x] T18 — Test determinista de R6: un propietario creado sin credenciales no puede iniciar sesión con contraseña vacía, nula ni arbitraria → 401 en los tres casos. **Cubre: R6.**

- [x] T19 — Test determinista de R8: (a) el login por email de un usuario con credenciales sigue devolviendo `access_token`; (b) `email` nulo, ausente y `''` → 401; (c) existiendo un `user` con `email` NULL y `password_hash` NULL, ninguna de esas peticiones lo autentica (verificado también por ausencia de entrada de login en `audit_log`). **Cubre: R8.**

- [x] T20 — Test de atomicidad (Testcontainers): forzar el fallo del INSERT del perfil y verificar que no quedan filas nuevas en `user` ni en `user_role`. **Cubre: R22.**

- [x] T21 — Test de identidad: (a) email ya existente en el tenant B → se crea solo `user_role` + perfil en el tenant A y la respuesta no contiene datos del perfil del tenant B; (b) creación **sin email** de una persona cuyo `documento` ya existe en el tenant B → se crea un `user` nuevo y no se vincula al existente. **Cubre: R25, R26.** ⚠️ *El caso (a) prueba R25, eliminado por D-8: T58 lo retira. El caso (b) sigue vigente (R26/R62).*

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

---

# v4 — Corrección de los hallazgos de la revisión (T48–T68)

> El `reviewer` rechazó la feature el 2026-07-27 con cuatro hallazgos críticos
> (`progress/review_owner_tenant_profiles.md`). El humano decidió arreglarlos
> **dentro de #5** (`design.md` §15, D-11). Cobertura: **R38–R72 en 25 tasks**
> (T48–T72), de las cuales 12 son tasks de test.
>
> **Reescrito el 2026-07-27 tras D-8 … D-13.** B2 quedó cerrado (T48, T49 y T53
> están hechas); B1 y B4 encogieron; entran los bloques de identidad por tenant
> (D-8) y de contacto en el perfil (D-9).
>
> ## Orden de ejecución (invariante de secuencia: el login nunca queda roto)
>
> ```
> hechas        T48 T49        puerta: test:db en init.sh + guard anti-DDL
> hechas        T53            B2: triggers append-only en migración
>  1            T50 T51 T52    B1: toda escritura sobre `user` va acotada al tenant
>  2            T54 T73 T55 T56  D-8/D-12 esquema: user.tenant_id, tenant.codigo, política estándar, tenant_por_codigo
>  3            T57 T58 T59    D-8 aplicación: login por (codigo,email) e identidad siempre nueva
>  4            T69 T70 T71 T72  D-9: el contacto se muda al perfil
>  5            T60 T61 T62 T63 T64  B3/D-10: rol sin BYPASSRLS (el conmutador)
>  6            T65 T66 T67 T68  re-verificación de §C7 con el rol real
> ```
>
> **Por qué este orden y no otro** (`design.md` §16 y §20.5):
> - Los pasos 2, 3 y 4 se hacen mientras la app **todavía** se conecta como
>   superusuario: las políticas nuevas son inertes y la suite queda verde tras
>   cada task.
> - El paso 3 **debe** ir inmediatamente después del 2: en cuanto `user` tiene
>   `tenant_id` y la unicidad de correo pasa a ser por tenant, un login que
>   busque solo por `email` puede resolver una fila ambigua. Entre T54 y T57 el
>   login sigue funcionando (no hay correos repetidos todavía), pero **no se debe
>   sembrar ningún correo duplicado hasta que T57 esté hecha**.
> - El paso 5 es el **único conmutador**: cuando `DATABASE_URL` pasa al rol sin
>   `BYPASSRLS`, todo lo que ese cambio activa ya está escrito y probado.
>   Adelantarlo deja el login devolviendo 401 a todo el mundo.
> - El bloque de D-9 (T69–T72) va **después** de T57–T59 porque mueve el correo
>   de contacto fuera de `user`: hacerlo antes de que el login deje de depender
>   de `user.email` mezclaría dos cambios sobre la misma columna.
>
> Los números T69–T72 son posteriores por no renumerar lo ya hecho; su lugar en
> la secuencia es el paso 4, tal como muestra la tabla.

## Bloque 9 — Puerta de verificación (va primero: es la causa de fondo)

- [x] T48 — Añadir `run_script test:db` a `init.sh`, junto a `lint`, `typecheck` y `test`, y dejar escrito en el propio script por qué esa suite es parte del semáforo. Verificar que `./init.sh` sigue en verde. **Cubre: R56.**

- [x] T49 — Crear `tests/ddl-en-tests.test.ts`: recorre los archivos de test de `apps/api/**` y falla si encuentra `CREATE TRIGGER`, `CREATE POLICY`, `CREATE FUNCTION`, `CREATE ROLE` o `GRANT` fuera de una **lista blanca justificada** (hoy: la inyección de fallos del test de atomicidad de R22). La lista lleva archivo + motivo, como `TABLAS_PERMITIDAS`. **Cubre: R57.**

## Bloque 10 — B1: toda escritura sobre `user` va acotada al tenant

> Reescrito tras D-8 y D-9: desaparece el 409 (no hay identidades compartidas) y
> el `PATCH` dejará de escribir contacto en `user` (D-9, paso 4). Lo que queda es
> el defecto de fondo: una escritura sin condición de tenant.

- [x] T50 — Modificar `propietarios.repository.ts` e `inquilinos.repository.ts`: el `UPDATE "user"` incorpora la condición de pertenencia al tenant —`EXISTS (… ur.tenant_id = $tenant)` **y** `NOT EXISTS (… ur.tenant_id <> $tenant)`, predicado válido antes y después de la migración de D-8— y devuelve el número de filas afectadas. **Cubre: R38.**

- [x] T51 — En `propietarios.service.ts` e `inquilinos.service.ts`, traducir "0 filas afectadas" a `ResourceNotFoundError` (**404**, no se confirma la existencia de una identidad ajena). **No** se crea `IdentidadCompartidaNoEditableError`: R39 quedó eliminado por D-8. **Cubre: R38, R31.**

- [x] T52 — Test HTTP determinista de escritura cruzada sobre `user`: partiendo de dos identidades homónimas —una por tenant, según D-8—, un `PATCH` del tenant A que apunte al `user` del tenant B responde **404** y un `SELECT` independiente confirma que ninguna columna de esa fila cambió; el `PATCH` sobre la identidad propia sí actualiza. **Cubre: R38.**

## Bloque 11 — B2: auditoría realmente inmutable

- [x] T53 — Crear la migración `0006_auditoria_append_only.sql` con `audit_log_prevent_mutation()` y los triggers `BEFORE UPDATE` y `BEFORE DELETE` sobre `audit_log`, idempotentes. Su cabecera declara explícitamente qué faltaba en `0004_auditoria.sql:4` y por qué ese archivo **no** se edita (hash de Drizzle). Añadir la entrada al journal. **Cubre: R40, R41, R42.**

## Bloque 12 — D-8, esquema: `user` pasa a ser una tabla por tenant

> La app sigue conectándose como superusuario durante todo este bloque: las
> políticas nuevas son inertes y nada se rompe.

- [x] T54 — Crear la migración `0007_identidad_por_tenant.sql`: añade `user.tenant_id` (backfill desde `user_role`, **abortando** si alguna identidad tiene roles en más de un tenant), lo deja `NOT NULL` con FK a `tenant(id)`, sustituye la `UNIQUE(email)` global por `UNIQUE (tenant_id, email)`, añade `UNIQUE (id, tenant_id)` y la FK compuesta `(user_id, tenant_id)` desde `user_role`, y reemplaza la política `user_tenant_isolation` (`FOR ALL` sin `WITH CHECK`) por la política estándar del proyecto con `USING` y `WITH CHECK` sobre `tenant_id`. En la misma migración: añadir `tenant.codigo text NOT NULL UNIQUE` con el `CHECK` de formato de R73, derivándolo del `nombre` de cada tenant existente de forma determinista antes de imponer las restricciones (R76). En la misma corrida: adaptar las semillas y fixtures que ya no son representables —`entorno-clientes.ts` crea hoy una identidad `multiTenant` con roles en A y B—, reescribir el caso de R33 que la usaba para que el 403 se pruebe con un `x-tenant-id` ajeno, y simplificar el predicado de T50 a `AND tenant_id = $tenant`. **Cubre: R33, R38, R49, R59, R60, R61, R73, R76.**

- [x] T55 — En la misma migración, crear `tenant_por_codigo(text) RETURNS uuid` (`SECURITY DEFINER`, coincidencia exacta sobre `tenant.codigo`, `REVOKE ALL … FROM PUBLIC` y `GRANT EXECUTE` al rol de aplicación), con un comentario que declare su superficie. Es la **única** ruta de lectura previa al contexto de tenant. **Cubre: R52.**

- [x] T56 — Crear `identidad-rls.test.ts` (Testcontainers, rol sin `BYPASSRLS` provisionado por el helper, **nunca creado por el test**): `INSERT` de identidad con el `tenant_id` propio permitido y con uno ajeno rechazado; `SELECT` limitado al tenant; `UPDATE` de fila ajena rechazado; `DELETE` sin privilegio; el mismo correo en dos tenants convive y repetido dentro del mismo tenant da `23505`; y la FK compuesta impide un `user_role` en otro tenant. **Cubre: R49, R59, R60.**

- [x] T73 — Tests deterministas del código de inmobiliaria (`migrations.db.test.ts` y unitarios): el `CHECK` rechaza mayúsculas, tildes, guion inicial/final, menos de 3 y más de 63 caracteres, y acepta `arrendamientos-sion`; dos tenants no pueden compartir código (`23505`); el backfill produce códigos derivados del `nombre` y resuelve colisiones con el sufijo más bajo, dando el **mismo** resultado en dos ejecuciones; y los nombres reservados (`www`, `api`, `app`, `admin`, `portal`, `static`, `mail`, `cdn`) se rechazan. **Cubre: R73, R75, R76, R77.**

> *Se ejecuta en el paso 2, justo después de T54; el número es posterior solo
> porque no se renumera lo ya hecho.*

## Bloque 13 — D-8, aplicación: login por inmobiliaria e identidad siempre nueva

> Sigue con la app como superusuario. Al terminar este bloque el login ya no
> depende de que el correo sea único global, que es la condición para que el
> conmutador del bloque 14 sea seguro.

- [x] T57 — Modificar `auth.service.ts`: `POST /auth/login` exige `codigo` además de `email` y `password` (400 si falta o si no cumple el formato de R73), lo normaliza a minúsculas sin espacios (R74) y resuelve el tenant con `tenant_por_codigo`; abre transacción, fija `app.current_tenant` y consulta `user` **bajo RLS**; conserva los 401 de R6 (sin `password_hash`) y R8 (email nulo o vacío) y responde 401 —mismo mensaje y mismo código— si el correo pertenece a otro tenant o si el `codigo` no existe. **Cubre: R51, R63, R64, R66, R74.**

- [x] T58 — Modificar `identidad.service.ts`: eliminar `vincularPorEmail` y todo rastro de reutilización entre tenants; la identidad es **siempre nueva** y se inserta con el `tenant_id` de la petición. Retirar los tests de R25 que ya no aplican, dejando constancia en el informe de implementación. Ajustar el JWT para que lleve los roles del único tenant del usuario. **Cubre: R26, R55, R62, R67.**

- [x] T59 — Tests deterministas del login por inmobiliaria: dos personas con **el mismo correo** en tenants distintos se autentican cada una con su `codigo` y obtienen el token de su tenant; ninguna de las dos autentica con el `codigo` de la otra (401); `codigo` inexistente → 401 (mismo cuerpo que unas credenciales inválidas); falta el `codigo` o tiene formato inválido → 400; el `codigo` en mayúsculas o con espacios sobrantes autentica igual (R74); siguen en verde los 401 de R6 y R8. **Cubre: R51, R63, R64, R65, R74.**

## Bloque 16 — D-9: el contacto se muda al perfil

> **Se ejecuta aquí**, entre el bloque 13 y el 14; los números T69–T72 son
> posteriores solo porque no se renumera lo ya hecho. Va después de T57 para no
> mezclar dos cambios sobre `user.email` (el login deja de depender de esa
> columna en T57; aquí deja de contener el correo de contacto).

- [x] T69 — Crear la migración `0008_contacto_en_perfil.sql`: añade `perfil_propietario.email_contacto` y `perfil_propietario.telefono_contacto` (ambas NULL) y `perfil_inquilino.email_contacto`; **copia** `user.email` y `user.telefono` de cada cliente a las columnas nuevas de su perfil; y solo entonces impone `NOT NULL` sobre `perfil_inquilino.email_contacto`. **Cubre: R68, R69, R70.**

- [x] T70 — Actualizar esquemas Drizzle, DTOs, repositorios, servicios y tipos compartidos: el contacto se lee y escribe en el perfil; al crear un cliente, `user.email` queda **NULL** y el correo recibido va a `email_contacto`. El `PATCH` deja de escribir `email` y `telefono` en `user`. **Cubre: R68, R69, R71.**

- [x] T71 — Tests del traslado: crear propietario con correo lo guarda en `perfil_propietario.email_contacto` y deja `user.email` NULL (verificado con `SELECT`); `GET /propietarios/:id` devuelve `email_contacto` y `telefono_contacto`; crear inquilino sin correo sigue dando **400** (R19, ahora sobre la columna del perfil); y un propietario sin correo se crea con `email_contacto` NULL. **Cubre: R68, R69, R71.**

- [x] T72 — Test de disponibilidad del dato de notificación: una consulta que lea **solo** el perfil devuelve destinatario (`email_contacto` o `celular`) y `medio_preferido_contacto`, sin `JOIN` a `user`. Dejar anotado en `progress/impl_owner_tenant_profiles.md` que la feature #10 (RF-N1) toma de ahí el destinatario. **Cubre: R72.**

## Bloque 14 — B3: rol de aplicación (el conmutador)

- [x] T60 — Crear `apps/api/src/database/rol-aplicacion.ts` con `asegurarRolDeAplicacion(urlDeMigracion, credenciales)`: idempotente, crea el rol `NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE LOGIN` y aplica los GRANT mínimos (USAGE en el esquema; SELECT/INSERT/UPDATE en tablas de negocio; SELECT/INSERT en `audit_log`; EXECUTE en `tenant_por_nit`; **ningún DELETE**). Invocarlo desde `db:migrate` después de aplicar las migraciones. **Cubre: R45, R46.**

- [x] T61 — Separar credenciales: `DATABASE_MIGRATION_URL` (rol privilegiado) y `DATABASE_URL` (rol de aplicación) en `.env.example`, `docker-compose.yml`, `init.sh` y `app-config.ts`, con `APP_DB_USER` y `APP_DB_PASSWORD`. `migrate.ts` pasa a leer `DATABASE_MIGRATION_URL`. **Cubre: R43, R47.**

- [x] T62 — Añadir el fail-fast de arranque: la app consulta `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user` y aborta con `ConfigurationError` accionable si alguno es `true`. **Cubre: R44.**

- [x] T63 — Migrar los entornos de prueba al rol provisionado: `entorno-clientes.ts` levanta la app con la cadena del rol de aplicación (no la del contenedor) y `clientes-rls.test.ts` deja de crear `app_test_user` a mano y usa `asegurarRolDeAplicacion`. **Cubre: R48, R57, R58.**

- [x] T64 — Tests del rol: `rol-aplicacion.test.ts` afirma contra la base real que el rol de la app **no** es superusuario, **no** tiene `BYPASSRLS` y **no** es dueño de las tablas; que no tiene privilegio `DELETE` en ninguna tabla ni `UPDATE`/`DELETE` sobre `audit_log` (`has_table_privilege`); y un test unitario de que el arranque aborta con un rol privilegiado. **Cubre: R43, R44, R45.**

## Bloque 15 — Re-verificación de §C7 con el rol real

- [x] T65 — Re-ejecutar la suite de aislamiento con la app corriendo bajo el rol de aplicación: los 9 accesos cruzados siguen en 404 **y**, además, una consulta cruda sin `WHERE` lanzada por la conexión de la app devuelve solo filas del tenant activo (prueba de que ahora mide el motor y no el `WHERE` del repositorio). Incluir el caso de escritura cruzada sobre `user` de T52. **Cubre: R38, R48, R58.**

- [x] T66 — Reescribir `audit-log.test.ts`: eliminar del `beforeAll` la creación de la función y los triggers; las aserciones de inmutabilidad corren contra el esquema que dejan las migraciones y, además, con el rol de aplicación (que ni siquiera tiene privilegio de UPDATE/DELETE). Verificar que el test **falla** si se comenta el `CREATE TRIGGER` de la migración. **Cubre: R40, R41, R57, R58.**

- [x] T67 — Actualizar `progress/impl_owner_tenant_profiles.md` con el mapa de trazabilidad `R38..R58 → test concreto`, el estado de #2/#3/#4 (revertidas a `in_progress`, cerradas por T65/T66) y las respuestas del humano a PA-8…PA-11 tal como se aplicaron. **Cubre: trazabilidad (`docs/specs.md`), `design.md` §17.**

- [x] T68 — Ejecutar `npm run lint`, `npm run typecheck`, `npm run test`, `npm run test:db` y `npm run build`; después `./init.sh` con exit code 0 —ahora incluyendo `test:db` en el semáforo—. **Verificación final.**
