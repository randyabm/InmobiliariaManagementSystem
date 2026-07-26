# Implementación — #5 `owner_tenant_profiles`

- **Agente:** implementer
- **Fecha:** 2026-07-27
- **Spec:** `specs/owner_tenant_profiles/{requirements,design,tasks}.md` (v3)
- **Estado:** **47/47 tasks completadas.** `./init.sh` **verde (exit 0)**.
- **Tests:** **142 → 257** en `npm run test` (+115). `npm run test:db`: 20 → 24.
- **La feature NO se ha marcado `done`**: eso lo deciden el reviewer y el humano.

---

## 1. Resultado de la verificación

```
npm run lint       OK
npm run typecheck  OK
npm run test       27 archivos, 257 tests, 257 passed
npm run test:db     1 archivo,  24 tests,  24 passed
npm run build      OK (types, api, web)
./init.sh          [OK] Entorno listo.  exit code = 0
```

| Suite | Antes | Después |
|---|---|---|
| `npm run test` (la que ejecuta `init.sh`) | 142 | **257** |
| `npm run test:db` | 20 passed + **4 fallando** | **24 passed** |

> Los 4 fallos de `npm run test:db` **ya existían antes de esta feature** y no
> los veía nadie porque `init.sh` no ejecuta esa suite. Ver §5.1.

---

## 2. Tasks

Las **47** están marcadas `[x]` en `specs/owner_tenant_profiles/tasks.md`.

| Bloque | Tasks | Estado |
|---|---|---|
| 1 — Esquema y migración | T1–T10 | ✅ |
| 2 — Contexto de tenant (deuda de #2/#3) | T11–T14 | ✅ |
| 3 — Identidad y login tras D-5 | T15–T21 | ✅ |
| 4 — Propietarios | T22–T27 | ✅ |
| 5 — Cuentas bancarias y punto de extensión a #6 | T28–T32 | ✅ |
| 6 — Inquilinos | T33–T36 | ✅ |
| 7 — Invariantes de seguridad | T37–T42 | ✅ |
| 8 — Integración y cierre | T43–T47 | ✅ |

### Única desviación de orden

**T20 y T21** (tests de atomicidad y de identidad entre tenants) ejercitan
`POST /propietarios`, que crea **T25**. Se escribieron junto al resto de los
tests de integración, después de T25, en
`modules/core/clientes/__tests__/propietarios.api.test.ts`. El código de T15
(`identidad.service.ts`) sí se escribió en su turno. Ninguna task quedó sin
test.

---

## 3. Trazabilidad R1–R37 → test concreto (T45)

Archivos:

- `A` = `apps/api/test/db/migrations.db.test.ts`
- `B` = `apps/api/src/database/__tests__/clientes-rls.test.ts`
- `C` = `apps/api/src/common/tenant/__tests__/resolver-tenant.test.ts`
- `D` = `apps/api/src/modules/core/auth/__tests__/login-tras-d5.test.ts`
- `E` = `apps/api/src/modules/core/clientes/__tests__/propietarios.api.test.ts`
- `F` = `apps/api/src/modules/core/clientes/__tests__/inquilinos.api.test.ts`
- `G` = `apps/api/src/modules/core/clientes/__tests__/cuentas-de-giro.test.ts`
- `H` = `apps/api/src/modules/core/clientes/__tests__/seguridad.api.test.ts`
- `I` = `apps/api/src/modules/core/__tests__/routes-surface.test.ts`
- `J` = `tests/migrations.test.ts`

| R | Test concreto |
|---|---|
| R1 | `A` › *perfil_propietario tiene sujeto_retencion y NINGUNA columna de tarifa*; `A` › *las dos UNIQUE de R1/R2*; `E` › *crea el propietario con datos personales y sujeto_retencion* |
| R2 | `A` › *las dos UNIQUE de R1/R2*; `F` › *crea el inquilino con los seis campos mínimos* |
| R3 | `E` › *la primera cuenta queda predeterminada…*; `A` › *el índice único parcial…* |
| R4 | `B` › *rechaza una segunda cuenta activa con es_predeterminada = true*; `B` › *el índice es parcial…*; `A` › *el índice único parcial de cuenta predeterminada existe* |
| R5 | `A` › *la tabla %s existe con RLS habilitado Y FORZADO* (×3); `A` › *la política de aislamiento de %s filtra por app.current_tenant* (×3); `B` › *un SELECT \* SIN WHERE sobre %s…* (×3) |
| R6 | `D` › *un cliente registrado sin credenciales no entra con %s* (×3); `A` › *user.email y user.password_hash son NULL-able*; `E` › *crea el propietario SIN email…* |
| R7 | `B` › *admite varias identidades con email NULL*; `B` › *sigue rechazando dos identidades con el MISMO email no nulo*; `A` › *la UNIQUE de user.email se conserva intacta* |
| R8 | `D` › *un usuario con credenciales sigue obteniendo access_token*; `D` › *%s devuelve 401* (×5); `D` › *existiendo identidades con email NULL, ninguna…*; `D` › *normalizarEmailDeLogin…* |
| R9 | `E` › *repetir el documento en el mismo tenant devuelve 409*; `E` › *el mismo documento en OTRO tenant no aparece en la búsqueda* |
| R10 | `E` › *crea el propietario con datos personales y sujeto_retencion…*; `E` › *el empleado también puede crear*; `E` › *rechaza con 400 si faltan los campos mínimos* |
| R11 | `E` › *la primera cuenta queda predeterminada y el PATCH deja exactamente una* |
| R12 | `E` › *devuelve 200 con datos personales, sujeto_retencion y la cuenta predeterminada*; `E` › *NO expone propiedades ni certificados fiscales*; `E` › *GET de cuentas lista las activas…* |
| R13 | `E` › *el PATCH parcial aplica solo los campos enviados y refresca updated_at* |
| R14 | `E` › *el DELETE deja la fila con activo = false y NO la borra* |
| R15 | `E` › *…el PATCH deja exactamente una*; `G` › *tras cambiar la predeterminada, la resolución sin override sigue la nueva* |
| R16 | `E` › *crea el propietario con… sujeto_retencion*; `E` › *el PATCH parcial…* (pone `sujeto_retencion: true`) |
| R17 | `E` › **NO expone ningún porcentaje ni tarifa de retención (R17, D-2)** |
| R18 | `F` › *crea el inquilino con los seis campos mínimos y responde 201 con su id* |
| R19 | `F` › *omitir %s devuelve 400 y no persiste ninguna fila* (×6); `F` › *un medio_preferido_contacto fuera del enum devuelve 400*; `F` › *el email vacío o inválido devuelve 400* |
| R20 | `F` › *el PATCH parcial cambia medio_preferido_contacto y refresca updated_at*; `F` › *el PATCH con un medio inválido devuelve 400 y no cambia nada* |
| R21 | `F` › *el DELETE deja la fila con activo = false y NO la borra* |
| R22 | `E` › **si falla el INSERT del perfil, no quedan filas nuevas en user ni user_role**; `F` › *crea la identidad y el rol `inquilino` en el tenant* |
| R23 | `E` › *la búsqueda por documento devuelve el perfil del tenant, o lista vacía*; `E` › *el mismo documento en OTRO tenant no aparece*; `F` › *la búsqueda por documento y el 409…* |
| R24 | `E` › *repetir el documento en el mismo tenant devuelve 409 PERFIL_YA_EXISTE*; `F` › *la búsqueda por documento y el 409 por documento repetido* |
| R25 | `E` › **(a) reutiliza el user existente en otro tenant sin filtrar su perfil ajeno** |
| R26 | `E` › **(b) SIN email crea identidad nueva y no vincula por documento** |
| R27 | `G` › *(a) con override válido devuelve el override, no la predeterminada* |
| R28 | `G` › *(b) sin override devuelve la predeterminada activa* |
| R29 | `G` › *(c) el override de OTRO propietario…*; `G` › *(d) el override de OTRO tenant…*; `G` › *un override inexistente…* |
| R30 | `G` › *(e) sin predeterminada y sin override lanza, NUNCA devuelve null* |
| R31 | `H` › **los 9 accesos cruzados devuelven 404**; `H` › *ningún acceso cruzado modificó los datos del tenant B*; `B` › *pedir por id una fila de otro tenant no la devuelve*; `B` › *un UPDATE dirigido a una fila de otro tenant…*; `B` › *no se puede INSERTAR una fila con el tenant_id de otro* |
| R32 | `H` › **un usuario cuyo único rol activo es `propietario` recibe 403 en las 13 rutas**; `H` › *…`inquilino`… 403 en las 13 rutas*; `H` › *sin token, las 13 rutas devuelven 401*; `C` › *RolesGuard…* (5 casos) |
| R33 | `H` › *un x-tenant-id sin rol activo en el JWT devuelve 403*; `H` › *una identidad multi-tenant SIN header recibe 403*; `H` › *esa misma identidad CON header escribe en el tenant indicado*; `C` › *resolverTenantDePeticion (R33)* (7 casos) |
| R34 | `C` › *obtenerClienteTenant…* (3 casos); `C` › *construirContextoPeticion…* (3 casos); `B` › *en una conexión virgen…* (×3); `B` › *con el GUC presente pero VACÍO, la consulta a %s falla* (×3) |
| R35 | `H` › **cada una de las 8 mutaciones deja exactamente una entrada en audit_log**; `H` › *la auditoría se escribe en el tenant resuelto, no en roles[0]* |
| R36 | `H` › **ni audit_log.metadata ni la salida del proceso contienen datos personales**; `H` › *el 404 de un recurso ajeno no filtra datos ni SQL*; `E` › *el 409 no filtra el documento de nadie*; `F` › *el 400 no devuelve el valor rechazado* |
| R37 | `J` › *ninguna migración de esta feature crea tablas de negocio* (TABLAS_PERMITIDAS +3); `I` › *no registra ninguna ruta fuera de la lista blanca* (RUTAS_PERMITIDAS +13); `H` › *las 13 rutas están cubiertas por esta tabla*; `A` › *aplica la migración inicial y registra su ejecución* (6 migraciones) |

**Ningún `R<n>` queda sin cobertura.** Todos los invariantes de seguridad
(R31–R36) se verifican de forma **determinista** —códigos de estado y `SELECT`
contra PostgreSQL real con Testcontainers—, nunca con juicio de un modelo
(CHECKPOINTS.md §C7, `docs/verification.md`).

---

## 4. Decisiones técnicas tomadas

Ninguna es una decisión de producto: el spec fijó todas. Estas son de
implementación.

### 4.1 El contrato HTTP va en `snake_case`

El spec escribe literalmente `tipo_documento`, `sujeto_retencion`,
`medio_preferido_contacto`, `es_predeterminada`. Los DTOs, las respuestas y
`packages/types/src/clientes.ts` usan esos mismos nombres, idénticos a las
columnas. Es la única excepción al `camelCase` de `docs/conventions.md` y
evita una capa de traducción que solo serviría para introducir erratas.

### 4.2 Doble barrera de aislamiento en los repositorios

Los repositorios consultan **solo** sobre el `PoolClient` de la transacción
(R34) **y además** llevan `tenant_id = $n` explícito en cada `WHERE`.

- El RLS `FORCE` es la garantía real, y se demuestra con un rol **sin
  `BYPASSRLS`** en `clientes-rls.test.ts`.
- El `tenant_id` explícito es defensa en profundidad. **No es redundante hoy**:
  la aplicación se conecta con el usuario dueño/superusuario de PostgreSQL, que
  se salta el RLS por completo (§5.2). Sin esta segunda barrera, el aislamiento
  a través de HTTP dependería de un detalle de configuración del rol.

### 4.3 Resolución del tenant: estricta en el guard, permisiva en el interceptor

`common/tenant/resolver-tenant.ts` (archivo nuevo, no listado en design.md §13)
concentra la regla para que `RolesGuard` y `TenantContextInterceptor` no puedan
divergir. Dos variantes:

- `resolverTenantDePeticion` (**estricta**, la de R33): la usa `RolesGuard`, o
  sea **las 13 rutas de negocio**. Header ajeno, o ausencia de header con 0 o
  >1 tenants → **403 sin tocar la base de datos** (el guard corre antes que los
  interceptores).
- `resolverTenantOpcional`: la usa el interceptor global, que corre también
  sobre rutas públicas. Sin JWT → sin contexto y **sin conectar** (`GET /health`
  sigue respondiendo sin PostgreSQL, R14 de la #1). Header presente que no casa
  → 403 igualmente. Sin header y con varios tenants → sin contexto, para no
  romper `GET /auth/me` a una identidad multi-inmobiliaria, que es justo el
  caso de RF-AU6.

### 4.4 `TenantContextInterceptor`: `concatMap` en lugar de `tap`

Con `tap`, el `COMMIT` quedaba en una promesa suelta y la respuesta podía
salir con la transacción aún abierta. Ahora el `COMMIT` (o el `ROLLBACK`)
termina **antes** de que Nest serialice la respuesta. Además el tenant se fija
con `set_config($1,$2,true)` parametrizado, no interpolando el header en el SQL.

### 4.5 Cambios en la maquinaria de auditoría de la #4 (necesarios para R35)

El `@Audit` de la feature #4 **no estaba registrado en ninguna parte**: el
decorador existía y no producía ninguna fila. Se ha enganchado con
`@UseInterceptors(AuditInterceptor)` en los tres controllers de `clientes/`
(ámbito acotado, sin cambiar el comportamiento de otras features), y se
corrigieron tres defectos que impedían cumplir R35:

1. El tenant salía de `roles[0].tenant_id` → ahora de `request.tenantResuelto`.
2. `tap` con promesa suelta → `concatMap`: la fila existe antes de responder.
3. `entity_id` se toma también de los parámetros de ruta, para que las bajas
   lógicas (sin cuerpo de respuesta) queden trazadas.

Y en `AuditService.log`, la escritura abre **su propia** transacción con
`SET LOCAL app.current_tenant`. Sin eso, la política de INSERT de `audit_log`
(RLS + `FORCE`) rechazaría la fila en cuanto la aplicación dejara de conectarse
como superusuario.

### 4.6 `PATCH` de cuenta bancaria: solo `es_predeterminada: true`

Es literalmente lo que pide R15. No se acepta `false` (dejaría el giro del
canon irresoluble, R30) ni la edición de banco/número/titular: el spec no lo
pide y cambiar una cuenta de giro en caliente merece su propio requirement.

### 4.7 T39: `cuenta_bancaria` no tiene ruta `DELETE`

T39 pide 9 accesos cruzados con `GET`/`PATCH`/`DELETE`. `cuenta_bancaria` no
expone `DELETE` en esta feature (design.md §5 define 13 rutas y ninguna lo es),
así que sus tres accesos cruzados son **listar, crear y actualizar**. Siguen
siendo 9 casos y cubren todas las operaciones expuestas sobre la entidad.

---

## 5. Contradicciones y defectos detectados (para el reviewer y el humano)

### 5.1 `npm run test:db` estaba **rojo** antes de esta feature ✅ corregido

`apps/api/test/db/migrations.db.test.ts` consultaba
`SELECT polname FROM pg_policies`. Esa vista expone `policyname`, no
`polname`: **4 tests fallaban con `column "polname" does not exist`**, y por
tanto las políticas RLS de `tenant`, `user`, `user_role` y `audit_log`
**nunca se habían verificado de verdad**. Confirmado reproduciendo el fallo con
mi cambio revertido (8 ocurrencias). Corregido a `policyname AS polname`.

Causa de fondo: **`init.sh` no ejecuta `npm run test:db`**, así que el verde de
`init.sh` no cubre esa suite. Recomendación al humano: añadir `test:db` a
`init.sh` (o a CI), o la próxima regresión de RLS volverá a pasar inadvertida.

### 5.2 La aplicación se conecta a PostgreSQL como **superusuario** ⚠️ abierto

`FORCE ROW LEVEL SECURITY` alcanza al dueño de la tabla, pero **no a un
superusuario ni a un rol con `BYPASSRLS`**. Hoy la app usa el usuario por
defecto de PostgreSQL, que es superusuario, así que **en ejecución el RLS no se
está aplicando**: el aislamiento real lo sostienen los `WHERE tenant_id = $n`
de los repositorios (§4.2).

Los tests de RLS son válidos porque hacen `SET ROLE app_test_user` explícito,
pero eso prueba el motor, no el despliegue. **Falta un rol de aplicación sin
`BYPASSRLS` y su migración de `GRANT`s.** No lo he creado: el spec de #5 no lo
contempla y crear el modelo de roles de base de datos es una decisión de
infraestructura. **Recomiendo una feature propia.**

### 5.3 La política RLS de `user` choca con la identidad multi-tenant ⚠️ abierto

`0003_auth_rbac.sql` define:

```sql
CREATE POLICY "user_tenant_isolation" ON "user" FOR ALL
  USING ("id" IN (SELECT "user_id" FROM "user_role"
                   WHERE "tenant_id" = current_setting('app.current_tenant', true)::uuid
                     AND "activo" = true));
```

Es una política `FOR ALL` sin `WITH CHECK`, así que PostgreSQL usa el `USING`
también como `WITH CHECK`. Con un rol sujeto a RLS eso rompe **dos** cosas que
esta feature necesita:

1. **Crear una identidad es imposible.** Al insertar en `user`, el `WITH CHECK`
   exige que ya exista su `user_role`… que aún no se puede insertar porque la
   FK apunta al `user` que se está creando. Bloqueo circular (R22).
2. **Vincular por email entre tenants es imposible.** R25 exige reutilizar el
   `user` cuyo email ya existe **aunque sea de otra inmobiliaria** (RF-C2 /
   RF-AU6). La política lo oculta, así que el `SELECT` no lo encuentra, se
   intenta crear uno nuevo y colisiona con `UNIQUE(email)`.

Hoy no explota **solo** por el defecto 5.2. **Es una contradicción entre el
esquema cerrado de #3 y los requisitos R22/R25 de #5, y no la he resuelto por
mi cuenta**: `user` es una tabla de identidad global (sin `tenant_id`) con una
política pensada para tablas con `tenant_id`, y arreglarla bien implica decidir
el modelo de visibilidad de identidades entre tenants — decisión de producto y
de seguridad que corresponde al humano. Se arreglará junto con 5.2.

### 5.4 `AuthService.getProfile` declara `email: string` y ya puede ser `null`

Consecuencia menor de D-5. No lo he tocado porque `GET /auth/me` está fuera del
alcance de #5 y su tipado sale de un `as`. Anotado para la feature del portal
del cliente, que además tendrá que decidir el identificador del JWT de un
usuario sin correo (design.md §7.2).

### 5.5 La suite `api` **sí** necesita Docker, pese a lo que dice su comentario

`apps/api/vitest.config.ts` afirma que la suite «NO requiere Docker». Es falso
desde la feature #4: `tenant-rls.test.ts`, `auth-rbac.test.ts` y
`audit-log.test.ts` ya levantaban contenedores. He seguido ese precedente
—mis tests de RLS, HTTP y auditoría viven en `src/**/__tests__/`— **a
propósito**, para que `./init.sh` verifique de verdad los invariantes de
seguridad en vez de darlos por buenos. Si el humano prefiere el reparto que
promete el comentario, habría que mover 7 archivos a `test/db/` **y** añadir
`test:db` a `init.sh`; si no, el verde de `init.sh` dejaría de cubrir el
aislamiento.

---

## 6. Dependencias hacia otras features (T32)

### Feature #6 `properties` — dependencia dura sobre #5

1. Añadir en su migración:
   `propiedad.cuenta_bancaria_id uuid NULL REFERENCES cuenta_bancaria(id)`.
2. Llamar a
   `CuentasBancariasService.resolverCuentaDeGiro(propiedad.perfil_propietario_id, propiedad.cuenta_bancaria_id, ctx)`
   donde se calcule el giro del canon. El servicio ya está exportado por
   `ClientesModule` y `properties → core/clientes` es una dependencia legal.
3. Añadir un **test de integración del override a través de la propiedad**. La
   regla de precedencia y la validación de pertenencia ya están probadas aquí
   (`cuentas-de-giro.test.ts`), pero nadie ha ejercitado aún el camino real.
4. **Entregar la lista de propiedades del propietario**, diferida por **D-1**.
   `GET /propietarios/:id` **no** expone `propiedades` y hay un test de
   contrato que lo impide: #6 tendrá que actualizarlo al añadir el campo.

### Feature #25 `retencion_codeudor_referencias` — dependencia dura sobre #5

- Consume `perfil_propietario.sujeto_retencion`, que ya existe. **#5 no calcula
  retención** (R17) y hay un test de contrato que lo verifica.
- Da por hechos: `obtenerClienteTenant`, el `TenantContextInterceptor`
  registrado, `SinContextoDeTenantError`, `PerfilYaExisteError`,
  `perfil_propietario` y `perfil_inquilino`.
- **Extiende `modules/core/clientes/`**; no crea un módulo paralelo. Sus tipos
  van a `packages/types/src/clientes.ts` y sus 10 rutas a `RUTAS_PERMITIDAS`.

### Módulo contable

Certificados fiscales, diferidos por **D-3**. #5 guarda solo los datos
fiscales (`sujeto_retencion`).

### Feature del portal del cliente (RF-AU2/AU4)

Debe decidir **qué identificador lleva el JWT de un usuario sin email** (D-5,
design.md §7.2). Hoy el payload incluye `email` y #5 no emite tokens de
clientes, así que no rompe nada todavía.

---

## 7. Archivos

### Creados

```
apps/api/drizzle/0005_owner_tenant_profiles.sql
apps/api/src/database/schema/{perfil-propietario,perfil-inquilino,cuenta-bancaria}.ts
apps/api/src/common/database/cliente-tenant.ts
apps/api/src/common/tenant/resolver-tenant.ts
apps/api/src/common/errors/tenant-no-autorizado.error.ts
apps/api/src/common/validation/zod-validation.pipe.ts
apps/api/src/modules/core/clientes/clientes.module.ts
apps/api/src/modules/core/clientes/identidad.service.ts
apps/api/src/modules/core/clientes/{propietarios,inquilinos,cuentas-bancarias}.{controller,service,repository}.ts
apps/api/src/modules/core/clientes/dto/{propietario,inquilino,cuenta-bancaria}.dto.ts
apps/api/src/modules/core/clientes/errors/index.ts
apps/api/src/modules/core/clientes/__tests__/{propietarios.api,inquilinos.api,cuentas-de-giro,seguridad.api}.test.ts
apps/api/src/common/tenant/__tests__/resolver-tenant.test.ts
apps/api/src/database/__tests__/clientes-rls.test.ts
apps/api/src/modules/core/auth/__tests__/login-tras-d5.test.ts
apps/api/test/support/entorno-clientes.ts
packages/types/src/clientes.ts
```

### Modificados

```
apps/api/src/database/schema/{index,user}.ts
apps/api/src/app.module.ts                     (APP_INTERCEPTOR: TenantContextInterceptor)
apps/api/src/common/interceptors/tenant-context.interceptor.ts
apps/api/src/common/errors/index.ts
apps/api/src/modules/core/core.module.ts
apps/api/src/modules/core/auth/{auth.service,roles.guard}.ts
apps/api/src/modules/core/audit/{audit.service,audit.interceptor}.ts
apps/api/src/modules/core/__tests__/routes-surface.test.ts   (+13 rutas)
apps/api/test/db/migrations.db.test.ts          (+ asserts #5, + fix `polname`)
apps/api/drizzle/meta/_journal.json             (entrada 5)
tests/migrations.test.ts                        (+3 tablas)
packages/types/src/index.ts
specs/auth_rbac/requirements.md                 (ENMIENDA: R1 superado por #5 R7)
specs/owner_tenant_profiles/tasks.md            (47/47 [x])
progress/current.md
```

**No se tocó** `feature_list.json`: la #5 sigue en `in_progress`, a la espera
del reviewer.

---

## 8. Comprobación contra CHECKPOINTS §C7

- **Aislamiento por tenant** — RLS `ENABLE`+`FORCE`+política en las 3 tablas, en
  la misma migración que las crea. Probado con rol sin `BYPASSRLS` (`B`) y sobre
  HTTP con 9 accesos cruzados que devuelven 404 (`H`). **Salvedad 5.2.**
- **RBAC en backend** — 13 rutas con `@Roles('admin','empleado')`; 403 para
  `propietario` e `inquilino` en las 13, 401 sin token (`H`).
- **Auditoría** — las 8 mutaciones producen exactamente una fila, con el tenant
  resuelto y el actor correctos (`H`).
- **Integridad documental** — no aplica: esta feature no maneja documentos
  firmados.
- **Datos personales** — ni `audit_log` (fila entera serializada) ni la salida
  del proceso contienen documento, titular_documento, celular, teléfono, email
  ni número de cuenta (`H`). Los 400/409/404 tampoco devuelven el valor
  rechazado.
- **Sin secretos** — ninguno nuevo. `JWT_SECRET` de test es el valor inerte ya
  existente en `test/support/test-env.ts`; la contraseña de los tests es la
  literal `clave-de-prueba-1234`.
