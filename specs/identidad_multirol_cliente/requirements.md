# Requirements — #26 `identidad_multirol_cliente`

**Título:** Identidad única por inmobiliaria y vista como propietario o inquilino
**Fase:** 1a · **`sdd`:** true
**PRD refs:** RF-C2, RF-C6, RF-AU1, RF-AU6 (+ RF-C1, RF-C3, RF-A1 para los
invariantes transversales)

---

## 0. Contexto y dependencias (léelo antes de los requirements)

Esta feature se construye **encima** de la #5 `owner_tenant_profiles`, cuyo
código ya está en `main` y cuyo spec fue **aprobado**. No la rehace.

**Dependencia dura:** la #5 debe estar `done`. De ella se reutiliza tal cual, sin
volver a construirlo:

| Activo de #5 | Dónde | Se reutiliza para |
|---|---|---|
| Rol de aplicación `NOSUPERUSER NOBYPASSRLS` | `apps/api/src/database/rol-aplicacion.ts` (`asegurarRolDeAplicacion`) | **Todo** test de aislamiento de esta feature. No se monta otro rol. |
| `user.tenant_id NOT NULL` + política `user_tenant_isolation` con `FORCE RLS` | `drizzle/0007_identidad_por_tenant.sql:289-297` | El motor sigue siendo quien aísla. |
| `UNIQUE (tenant_id, email)` en `user`, `UNIQUE (id, tenant_id)` + FK compuesta en `user_role` | `0007` | Impide identidades cruzadas a nivel de esquema. |
| `UNIQUE (tenant_id, tipo_documento, documento)` en `perfil_propietario` y `perfil_inquilino` | `0005_owner_tenant_profiles.sql:47-48,70-71` | El documento ya es único por tenant **dentro de cada rol**. |
| `IdentidadService.crearIdentidad`, `asegurarRol` (con `ON CONFLICT DO NOTHING`) | `clientes/identidad.service.ts` | Punto de extensión de esta feature. |
| `RolesGuard` + `resolverTenantDePeticion` | `auth/roles.guard.ts`, `common/tenant/resolver-tenant.ts` | RBAC en backend. |
| `AuditService.log` | `core/audit/audit.service.ts` | Auditoría de acciones críticas. |
| Guard anti-DDL en tests | `tests/ddl-en-tests.test.ts` | **No se amplía su lista blanca.** Ningún test de esta feature crea triggers, políticas, funciones o roles. |

### El problema que resuelve (deuda D5 del review #2 de la #5)

La decisión **D-9** de la #5 mudó los datos de contacto del cliente al perfil, de
modo que `user.email` quedó **NULL** para todo cliente registrado por la
inmobiliaria. Con eso desapareció la clave por la que reconocer a la misma
persona **dentro** de una inmobiliaria: hoy, quien sea propietario **e**
inquilino de la misma agencia son **dos filas de `user`**, con dos credenciales
potenciales. Como efecto colateral, `identidad.service.ts:94-104`
(`buscarEnEsteTenant`, búsqueda por `email`) quedó **inalcanzable**: ningún
llamador le pasa `email` (`propietarios.service.ts:59`, `inquilinos.service.ts:46`
invocan `crearIdentidad` con `{ nombre }` a secas). Verificado por el reviewer.

### Vocabulario (regla dura de `docs/conventions.md`)

En este proyecto **`tenant` = inmobiliaria**. Los dos roles de cliente son
**propietario** e **inquilino**. En este documento nunca se usa "tenant" para
decir "inquilino".

### Frontera de alcance

- Esta feature es **backend**. Expone la API para consultar los roles y elegir
  con cuál se actúa.
- El **selector visual** pertenece al portal del cliente (RF-AU2 actualizado /
  RF-AU4), que **no existe como feature en el tablero**. Queda anotado como
  dependencia futura en `design.md` §9. Aquí no se diseña ni una pantalla.
- **No se reintroduce la vinculación de identidades entre inmobiliarias.**
  **D-8 sigue vigente**: reutilizar identidad está **prohibido entre tenants** y
  **permitido dentro de uno** (`specs/owner_tenant_profiles/requirements.md:681-686`
  y su `design.md` §20.4). R14 lo fija con un test dedicado.

---

## Bloque A — Identidad única por inmobiliaria (deduplicación por documento)

### R1 — (RF-C2, RF-C6) Reutilización de identidad al crear un propietario

CUANDO se crea un perfil de propietario cuyo par (`tipo_documento`, `documento`)
ya corresponde a una identidad registrada en la misma inmobiliaria, el sistema
DEBE reutilizar esa identidad como `user_id` del nuevo perfil y NO DEBE insertar
una fila nueva en `user`.

### R2 — (RF-C2, RF-C6) Reutilización de identidad al crear un inquilino

CUANDO se crea un perfil de inquilino cuyo par (`tipo_documento`, `documento`)
ya corresponde a una identidad registrada en la misma inmobiliaria, el sistema
DEBE reutilizar esa identidad como `user_id` del nuevo perfil y NO DEBE insertar
una fila nueva en `user`.

### R3 — (RF-C2) El rol se añade a la identidad reutilizada

CUANDO se reutiliza una identidad existente para un rol que esa persona todavía
no tiene en esa inmobiliaria, el sistema DEBE insertar la fila de `user_role`
correspondiente con `activo = true`, dejando activas ambas filas de rol.

### R4 — (RF-C2, RF-AU1) Una sola credencial por persona e inmobiliaria

CUANDO se reutiliza una identidad existente, el sistema NO DEBE modificar su
`email` ni su `password_hash`.

> Es lo que hace que la persona multirol tenga **una sola credencial**: la
> segunda alta de perfil no crea ni pisa credenciales.

### R5 — (RF-C1) El documento es atributo de la identidad

El sistema DEBE almacenar `tipo_documento` y `documento` en la fila de `user` de
todo cliente creado a través de un perfil de propietario o de inquilino.

### R6 — (RF-C2, D-7) Unicidad del documento dentro de la inmobiliaria

El sistema DEBE rechazar en la base de datos la existencia de dos identidades
con el mismo (`tenant_id`, `tipo_documento`, `documento`).

> Se impone con un índice único **parcial** (`WHERE documento IS NOT NULL`):
> empleados y administradores pueden no tener documento registrado y no deben
> colisionar entre sí. Es el motor, no el servicio, quien lo garantiza.

### R7 — (RF-C6, D-4) El 409 por perfil repetido se conserva

SI se crea un perfil del **mismo rol** para un documento que ya tiene perfil de
ese rol en esa inmobiliaria ENTONCES el sistema DEBE responder **409**
`PERFIL_YA_EXISTE` y NO DEBE crear ni modificar ninguna fila.

> R1/R2 deduplican **la identidad**, no el perfil. Ser propietario dos veces
> sigue siendo un error; ser propietario **e** inquilino, no.

### R8 — (RF-C4, RF-C5, D-9) Los datos de contacto de cada perfil son independientes

CUANDO se reutiliza una identidad existente, el sistema DEBE conservar sin
alterar los datos de contacto (`email_contacto`, `telefono_contacto`,
`direccion_notificacion`, `ciudad`) del perfil preexistente, aunque el perfil
nuevo declare valores distintos.

> **Por qué no hay conflicto que resolver:** desde D-9 el contacto vive en el
> **perfil**, no en la identidad, y cada rol tiene el suyo. Que el propietario
> declare un correo y el inquilino otro es un estado **legítimo**, no una
> divergencia a reconciliar. Ver PREGUNTA ABIERTA **PA-1** en `design.md` §10
> para el único caso que sí queda abierto (el `nombre`, que sí es compartido).

### R9 — (RF-C1) El nombre de la identidad no lo pisa el segundo perfil

CUANDO se reutiliza una identidad existente y el perfil nuevo declara un
`nombre` distinto al de la identidad, el sistema DEBE conservar el `nombre`
almacenado en la identidad y NO DEBE sobrescribirlo.

> Regla conservadora y reversible: el `PATCH` de perfil de la #5 ya permite
> corregir el nombre explícitamente. Sujeta a **PA-1**.

### R10 — (RF-C6, D-4) La búsqueda de identidad nunca sale del tenant

CUANDO el sistema busca una identidad por documento para deduplicar, la consulta
DEBE incluir el `tenant_id` de la petición como predicado explícito, además del
Row-Level Security.

### R11 — (RF-C1, RF-C3) Se retira la búsqueda de identidad por correo

El sistema NO DEBE resolver identidades de cliente a partir del `email`.

> Cierra la deuda **D5**: `buscarEnEsteTenant` por `email` queda **sustituida**
> por la búsqueda por documento, no huérfana. El camino muerto desaparece
> (C3, `docs/conventions.md`: nada de código inalcanzable).

### R12 — (RF-C1, RF-C6) Atomicidad de la reutilización

SI la inserción del perfil falla después de haber añadido el `user_role` ENTONCES
el sistema DEBE deshacer también ese `user_role`, dejando la identidad con
exactamente los roles que tenía antes de la petición.

> Misma transacción que abre el `TenantContextInterceptor` (R22 de la #5).

### R13 — (RF-AU6, RF-C3) Auditoría de la reutilización de identidad

CUANDO el sistema reutiliza una identidad existente para añadirle un rol, DEBE
registrar en `audit_log` una entrada con la acción `identidad.rol_anadido`, el
`tenant_id`, el actor y el `user_id` reutilizado.

> Acción crítica: es el momento en que una credencial existente gana acceso a
> datos de un rol nuevo (§C7 "auditoría").

### R14 — (RF-AU6, D-8) La reutilización entre inmobiliarias sigue prohibida

SI existe una identidad con el mismo (`tipo_documento`, `documento`) en **otra**
inmobiliaria ENTONCES el sistema DEBE crear una identidad nueva en la
inmobiliaria de la petición y NO DEBE consultarla, reutilizarla ni revelar su
existencia.

> D-8 intacta. Este requirement existe para que la deduplicación de R1/R2 no la
> reintroduzca por la puerta de atrás.

---

## Bloque B — Vista como propietario o como inquilino

### R15 — (RF-AU1, RF-AU6) Consulta de los roles propios

CUANDO una identidad autenticada invoca `GET /auth/me`, el sistema DEBE devolver
la lista de sus roles **activos en la inmobiliaria del token**, y NO DEBE incluir
roles de ninguna otra inmobiliaria.

> Cubre además la deuda **D3** del review #2: `GET /auth/me` cambió en la #5 sin
> ningún test funcional.

### R16 — (RF-AU6) Elección del rol con el que se actúa

CUANDO una identidad autenticada invoca `POST /auth/rol-activo` con un rol que
tiene activo en la inmobiliaria del token, el sistema DEBE emitir un
`access_token` nuevo que declare ese rol como **rol activo**.

### R17 — (RF-C3) Un rol que no se tiene no se puede elegir

SI la identidad solicita como rol activo uno que no figura entre sus roles
activos en esa inmobiliaria ENTONCES el sistema DEBE responder **403** y NO DEBE
emitir ningún token.

### R18 — (RF-C3) El rol activo restringe, nunca amplía

MIENTRAS el token declare un rol activo, el sistema DEBE autorizar la petición
únicamente si el rol requerido por el endpoint coincide con ese rol activo,
aunque la identidad tenga otros roles activos en esa inmobiliaria.

> Es la mitad que importa del acceptance nº4: elegir "propietario" **quita**
> acceso a lo de inquilino; no se limita a ocultarlo.

### R19 — (RF-C3, RF-AU6) El rol activo se revalida en cada petición

CUANDO llega una petición con un token que declara un rol activo que la
identidad ya **no** tiene activo en esa inmobiliaria, el sistema DEBE rechazarla
con **403**.

> Un token es un dato firmado pero **viejo**: si se revocó el rol, el token no
> puede seguir concediéndolo hasta su expiración.

### R20 — (RF-AU1) Compatibilidad de los tokens sin rol activo

MIENTRAS el token no declare rol activo, el sistema DEBE autorizar exactamente
como antes de esta feature: basta con tener alguno de los roles requeridos,
activo en la inmobiliaria resuelta.

> Los empleados y administradores no eligen rol; el selector es para el cliente
> multirol. Ningún token vigente se invalida.

### R21 — (RF-AU6, RF-C3) Auditoría del cambio de rol activo

CUANDO se emite un token con rol activo, el sistema DEBE registrar en
`audit_log` una entrada con la acción `auth.rol_activo_elegido`, el `tenant_id`,
el actor y el rol elegido.

---

## Bloque C — Invariantes de seguridad obligatorios

### R22 — (RF-A1) Aislamiento por tenant

SI una petición autenticada en la inmobiliaria A solicita, mediante los endpoints
nuevos o modificados de esta feature, un recurso de la inmobiliaria B ENTONCES el
sistema DEBE responder **404** sin revelar su existencia.

### R23 — (RF-C3) Autorización en el backend

SI un usuario sin el rol requerido invoca cualquier endpoint nuevo o modificado
de esta feature ENTONCES el sistema DEBE rechazar la petición en el backend con
**403**.

### R24 — (RF-A1, D-10) El aislamiento se demuestra con el rol de aplicación real

Los tests de aislamiento de esta feature DEBEN ejecutarse contra PostgreSQL real
con el rol de aplicación `NOSUPERUSER NOBYPASSRLS` provisto por
`asegurarRolDeAplicacion`, y NO DEBEN crear ningún rol, política, función ni
trigger por su cuenta.

> Verificación **por mutación** obligatoria (estándar impuesto en la #5): cada
> invariante nuevo se declara cubierto solo si al romper deliberadamente lo que
> protege hay tests en rojo, y el informe de implementación cita cuáles.

---

## Bloque D — Deuda arrastrada del review #2 de la #5

### R25 — (D-10, deuda D4) `init.sh` falla ante una configuración inequívocamente rota

SI `DATABASE_URL` y `DATABASE_MIGRATION_URL` tienen el mismo valor ENTONCES
`init.sh` DEBE terminar con código de salida distinto de cero.

> Hoy es un `warn` (`init.sh:182-184`). Si coinciden, la API corre con el rol
> privilegiado y el aislamiento vuelve a ser inerte: no es un aviso, es un
> defecto. Los otros tres `warn` (variables ausentes) se quedan como `warn`:
> ahí el `warn` es la elección correcta y el review lo confirmó.

### R26 — (deuda D6) El spec de la #5 no se contradice a sí mismo

El titular de **R62** y el enunciado de **T58** de `specs/owner_tenant_profiles/`
NO DEBEN afirmar que la identidad es "siempre nueva" sin acotarlo a "de otra
inmobiliaria".

> Se corrige **el texto** del spec de la #5, sin tocar su código ni sus tasks
> ya ejecutadas: la implementación era correcta y el reviewer lo confirmó
> (review #2 §2, punto 3). Verificable con un test de repositorio sobre el
> contenido de esos dos archivos.

---

## Mapa requirement → acceptance de `feature_list.json`

| Acceptance | Requirements |
|---|---|
| Reutilizar identidad por documento | R1, R2, R3, R5, R6, R10, R11 |
| Propietario e inquilino a la vez, una sola credencial | R3, R4, R7, R8, R9, R12, R13 |
| Consultar y elegir rol | R15, R16, R21 |
| El rol elegido no amplía el acceso | R17, R18, R19, R20, R23 |
| No se reintroduce la vinculación entre inmobiliarias | R14, R22, R24 |
| `init.sh` falla si las dos URLs coinciden | R25 |
| Corregir R62/T58 de la #5 | R26 |
