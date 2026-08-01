# Implementación — #26 `identidad_multirol_cliente`

> Informe escrito **conforme avanza** la implementación, no al final.
> Spec: `specs/identidad_multirol_cliente/{requirements,design,tasks}.md`.
> 29 requirements (R1–R29), 31 tasks (T1–T31), una migración
> (`0009_identidad_por_documento.sql`).

**Línea base verificada antes de empezar** (por el humano):
`./init.sh` exit 0 · `npm run test` **372** · `npm run test:db` **56**.

---

## Bitácora por bloques

### Bloque 0 — Deuda del arnés (T1–T4) — hecho

- **T1 (R25)** — `init.sh`: el chequeo `DATABASE_URL == DATABASE_MIGRATION_URL`
  pasa de `warn` a `fail` con `EXIT_CODE=1`, y añade un `ok` explícito cuando
  difieren. Los tres `warn` por variables ausentes **se dejan intactos**: ahí el
  aviso es la elección correcta y el review lo confirmó.
- **T2 (R25)** — `tests/init-sh-roles-db.test.ts`, 4 tests. Ejecuta `init.sh`
  en un **directorio de arena** (archivos base mínimos, `feature_list.json`
  vacío, `.env` con credenciales inertes y **sin `package.json`**) para que el
  código de salida dependa solo del chequeo bajo prueba: URLs iguales → exit ≠ 0
  con `[FAIL]`; URLs distintas → exit 0 y `[OK]`. Ejecutarlo sobre el repo real
  recursaría lint+typecheck+ambas suites por caso.
- **T3 (R26)** — Texto corregido: titular de **R62** en
  `specs/owner_tenant_profiles/requirements.md` y enunciado de **T58** en su
  `tasks.md` → "nunca heredada de otra inmobiliaria". También las tres
  tablas-resumen que repetían la frase (`tasks.md` ×2, `design.md` ×1): dejarlas
  reintroducía la contradicción por la puerta de atrás. **No** se tocó código,
  estado ni marcas `[x]` de la #5.
- **T4 (R26)** — `tests/spec-identidad-siempre-nueva.test.ts`, 5 tests: el
  titular de R62 y el enunciado de T58 no dicen "siempre nueva", el titular sí
  acota a "otra inmobiliaria", T58 sigue `[x]` (se corrige texto, no se reabre) y
  ningún resumen repite la afirmación sin acotar.

### Bloque A — Identidad única por inmobiliaria (T5–T18, T29–T31) — hecho

- **T5 (R5, R6)** — `apps/api/drizzle/0009_identidad_por_documento.sql`.
  Columnas `tipo_documento`/`documento` NULL-ables en `user`, `CHECK` de dominio
  (mismo que los perfiles) y de coherencia (`(tipo IS NULL) = (doc IS NULL)`),
  backfill propietario→inquilino, aviso de colisiones y el índice único
  **parcial** `(tenant_id, tipo_documento, documento) WHERE documento IS NOT
  NULL`. **No crea tablas**, luego no hay política nueva: se apoya en
  `user_tenant_isolation` de `0007`, y eso se verifica (T7), no se asume.
  Registrada en `meta/_journal.json` (idx 9) y reflejada en el esquema Drizzle.
- **T6 (R5, R6)** — `apps/api/test/db/backfill-documento.db.test.ts`, 15 tests.
  Aplica migraciones **hasta 0008**, siembra el estado real —incluida la misma
  persona como **dos** identidades, que es el defecto que la feature cierra— y
  solo entonces aplica `0009`. Cubre columnas, los dos `CHECK`, el backfill
  desde ambos perfiles, el NULL de los empleados, la identidad duplicada (queda
  sin documento, **no** se fusiona, la migración **no** aborta), la forma del
  índice y la idempotencia.
- **T7 (R14, R22, R24)** —
  `apps/api/src/database/__tests__/identidad-por-documento-rls.test.ts`, 9 tests,
  con el rol de aplicación **sin `BYPASSRLS`** provisionado por
  `asegurarRolDeAplicacion`. Consultas **crudas** por documento (sin `WHERE
  tenant_id`): desde A solo se ve A, desde B solo B, ni un `count(*)` revela la
  otra, y el `WITH CHECK` impide colar una identidad en el tenant vecino.
- **T8, T9, T29 (R1–R5, R9, R10, R11, R27, R28)** — `identidad.service.ts`:
  `crearIdentidad` → **`resolverIdentidad`**, `buscarEnEsteTenant` por email
  **eliminada** (cierra la deuda D5: era código inalcanzable) y sustituida por
  `buscarPorDocumentoEnEsteTenant` con `tenant_id` explícito. Nueva función pura
  `nombresCoinciden` y `NombreNoCoincideConIdentidadError` (409). El rechazo
  ocurre **antes** de insertar el `user_role`.
- **T10, T11 (R1, R2, R7, R13)** — `propietarios.service.ts` e
  `inquilinos.service.ts` pasan documento y reciben `reutilizada`; el 409 de R7
  se comprueba **antes**, intacto. La auditoría vive en
  `auditoria-identidad.ts` (una sola regla, no dos copias) y se registra
  **después** del INSERT del perfil, para no auditar un alta que acabe deshecha.
- **T12, T30** — `clientes/__tests__/identidad.service.test.ts`, 14 tests:
  tabla de casos de `nombresCoinciden` (incluidos los dos que **no** coinciden y
  fijan la frontera de PA-5) y doble de `PoolClient` que registra el SQL:
  ninguna consulta filtra `user` por email, todas las de búsqueda llevan
  `tenant_id`, nada se concatena.
- **T13, T14, T15, T17, T18, T31** —
  `clientes/__tests__/identidad-multirol.api.test.ts`, 19 tests contra
  PostgreSQL real: una identidad con dos roles y **un solo** `password_hash`,
  contactos independientes por perfil, el 409 de nombre discrepante con su
  cuerpo accionable y **sin** escribir nada (verificado con `SELECT`), el camino
  feliz tras el `PATCH`, el 409 `PERFIL_YA_EXISTE`, la frontera D-8 y la
  auditoría `identidad.rol_anadido` sin documento en `metadata`.
- **T16 (R12)** — añadido a `propietarios.api.test.ts`, que es el archivo ya
  exento en `EXCEPCIONES_JUSTIFICADAS` para inyección de fallos: **la lista
  blanca no se amplió**. Identidad reutilizada + fallo del perfil → el
  `user_role` nuevo se deshace y la persona queda con los roles previos.

**Un test preexistente se reescribió, no se borró.** En
`inquilinos.api.test.ts`, el caso "el modelo admite los dos roles… aunque el
alta ya no deduplique (§7.4, D-9)" afirmaba **el defecto**: dos filas de `user`
para la misma persona. Es exactamente la deuda D5 que esta feature cierra, así
que pasa a afirmar el comportamiento correcto (una identidad, dos roles
activos), con la explicación de por qué cambió.

**Un cambio en el borde HTTP.** `AllExceptionsFilter` aprende a volcar los
`detalles` que un error de dominio (<500) declare a propósito: es lo que hace
posible el cuerpo accionable de R28 sin romper la forma única de
`ApiErrorResponse`. Los detalles **no** se registran en el log.

---

## Consulta de diagnóstico de identidades duplicadas (design.md §3)

La migración `0009` avisa con `RAISE WARNING` y el conteo, pero no deja ningún
objeto de esquema que nadie mantendría. Para ver **quiénes** son:

```sql
SELECT u.tenant_id, u.tipo_documento, u.documento, count(*) AS identidades,
       array_agg(u.id ORDER BY u.created_at) AS user_ids,
       array_agg(u.nombre ORDER BY u.created_at) AS nombres
  FROM "user" u
 WHERE u.documento IS NOT NULL
 GROUP BY u.tenant_id, u.tipo_documento, u.documento
HAVING count(*) > 1;
```

Tras aplicar `0009` esta consulta devuelve **cero filas** por construcción (el
índice único lo impide). Para encontrar las que la migración dejó **sin**
documento —las que se recrean, PA-2—:

```sql
SELECT u.id, u.tenant_id, u.nombre
  FROM "user" u
 WHERE u.documento IS NULL
   AND EXISTS (SELECT 1 FROM perfil_propietario p WHERE p.user_id = u.id
                UNION ALL
               SELECT 1 FROM perfil_inquilino  p WHERE p.user_id = u.id);
```

Un cliente **con perfil** y **sin** documento en su identidad solo puede venir
de una colisión limpiada por `0009`.

### Bloque B — Vista como propietario o como inquilino (T19–T26) — hecho

- **T19, T20, T22 (R16, R17, R19, R21)** — `AuthService.elegirRolActivo` +
  `POST /auth/rol-activo` + `RolNoDisponibleError` (403, mensaje genérico). El
  rol se comprueba contra `user_role` con `activo = true` **en la base**, dentro
  del contexto de tenant, no contra lo que afirma el token. Se audita
  `auth.rol_activo_elegido`. **No se implementa revocación**: es la #27.
- **T21 (R18, R20, R29)** — `jwt.strategy.ts` propaga `rol_activo` sin
  interpretarlo; `roles.guard.ts` es el **único** punto donde se aplica la
  regla, con `rolesEfectivos ⊆ rolesDelTenant` por construcción.
- **T23–T26** — `auth/__tests__/rol-activo.api.test.ts` (19 tests, API real) y
  `auth/__tests__/rol-activo-guard.test.ts` (9 tests, guard puro).

**Decisión de diseño que el reviewer debe mirar: cómo se demuestra R18.**
R18 pide que elegir "propietario" quite el acceso a lo de inquilino. Para
demostrarlo extremo a extremo harían falta **rutas que exijan rol de cliente**, y
**hoy no existe ninguna**: todas las rutas del sistema piden `admin` o
`empleado`, y el portal del cliente (RF-AU2/AU4) no está en el tablero. No se
inventaron endpoints para poder probarse. Se hizo así:

1. **Extremo a extremo, sobre rutas reales**, con una identidad `empleado` +
   `propietario`: eligiendo `propietario` las rutas de empleado pasan de 200 a
   **403** —misma identidad, mismos roles en la base, solo cambia la elección— y
   el `POST` tampoco escribe (verificado con `SELECT`).
2. **En el guard**, que es el único punto donde la regla vive, con los roles
   `propietario`/`inquilino` exactos del requirement y en las dos direcciones.

Ninguna de las dos sustituye a la otra. Cuando exista el portal del cliente, el
caso (1) debería reescribirse con sus rutas.

**Defecto latente encontrado y corregido de paso.** `AuthModule` hacía
`JwtModule.register({ secret: process.env.JWT_SECRET ?? 'dev-secret' })`, que
congela el secreto **al importar el archivo**. Cuando algo fija `JWT_SECRET`
después —lo que hace el arnés de tests—, la API **firmaba** con `dev-secret` y
`JwtStrategy` **verificaba** con el secreto real: todo token emitido por la
propia API era rechazado por ella misma. No se había visto porque ningún test
volvía a usar el token de `POST /auth/login`, y la #26 es la primera feature
cuyo endpoint existe para emitir uno. Pasa a `registerAsync` y **sin**
`dev-secret` de reserva: un valor por defecto solo sirve para que un despliegue
mal configurado emita tokens falsificables en silencio.

---

## Verificación por mutación (T27)

Cada invariante se declara cubierto **solo** porque se le ha visto ponerse rojo.
Números reales, reproducibles: se aplica la mutación, se corre la suite, se
revierte con `git checkout`. Línea base: `npm run test` **452**,
`npm run test:db` **71**.

| # | Mutación | Suite | Rojos | Requirement | Qué se pone rojo |
|---|---|---|---|---|---|
| **a** | `CREATE UNIQUE INDEX` → `CREATE INDEX` en `0009` | `test:db` | **2 / 71** | R6 | el índice deja de ser único y dos identidades con el mismo documento entran en el mismo tenant (`backfill-documento.db.test.ts`) |
| **b** | quitar `AND tenant_id = $3` de `buscarPorDocumentoEnEsteTenant` | `test` | **1 / 452** | R10 | `identidad.service.test.ts` › "la búsqueda … lleva tenant_id explícito" |
| **b+d** | lo anterior **y** `BYPASSRLS` al rol de aplicación | `identidad-multirol.api` | **2 / 19** | R10, R14 | T17: la misma persona en A y en B pasa a ser **una sola** identidad y el 409 de R9 se dispara con datos de la otra inmobiliaria |
| **c** | `rolesEfectivos = rolesDelTenant` en el guard | `test` | **4 / 452** | R18 | 2 en el guard (las dos direcciones propietario/inquilino) y 2 extremo a extremo (la ruta de empleado vuelve a autorizar y el POST vuelve a escribir) |
| **d** | `NOBYPASSRLS` → `BYPASSRLS` en `asegurarRolDeAplicacion` | `test` | **37 / 452** | R22, R24 | todo el aislamiento del proyecto, incluidos los 7 de `identidad-por-documento-rls.test.ts` y el "no obtiene perfil ninguno" de `/auth/me` |
| **e** | anular la llamada de auditoría de `auditarRolAnadido` | `clientes` | **2 / 116** | R13 | T18: no existe la entrada `identidad.rol_anadido` |
| **f** | `nombresCoinciden` devuelve siempre `true` | `test` | **9 / 452** | R9, R27 | 5 unitarios (criterio y 409) y 4 de API (el alta discrepante pasa a **201** y escribe) |

**Sobre (b), y es importante que el reviewer lo lea.** La mutación (b) sola
produce **un** rojo, no varios: con el rol correctamente configurado, el RLS ya
impide que la consulta alcance otra inmobiliaria, así que el predicado explícito
es —como dice su comentario— **defensa en profundidad**, no la barrera
principal. La mutación **(b+d)** es la que demuestra para qué sirve: en cuanto
el motor deja de aislar, quitar ese `AND tenant_id` reintroduce **exactamente**
la vinculación entre inmobiliarias que D-8 prohíbe. Se documentan las dos: la
primera dice qué test lo fija, la segunda dice por qué el código existe.

**R25** tiene su propia mutación permanente en el test: el cuarto caso de
`init-sh-roles-db.test.ts` afirma que el chequeo es `fail` y **no** `warn`, de
modo que devolverlo a `warn` pone dos tests en rojo (ese y el del exit code).

---

## Trazabilidad R → test (T28)

| R | Test que lo fija |
|---|---|
| R1, R2 | `identidad-multirol.api.test.ts` › T13 "el segundo alta reutiliza la identidad"; `inquilinos.api.test.ts` › "la misma persona con los dos roles es UNA identidad" |
| R3 | `identidad-multirol.api.test.ts` › T13 (roles activos); `identidad.service.test.ts` › "el rol se inserta con activo = true e idempotente" |
| R4 | `identidad-multirol.api.test.ts` › "una sola credencial…"; `identidad.service.test.ts` › "no toca email, password_hash ni nombre" |
| R5 | `backfill-documento.db.test.ts` › columnas y backfill; `identidad-multirol.api.test.ts` › T13 (documento en `user`) |
| R6 | `backfill-documento.db.test.ts` › "el índice único parcial…" (4 tests) · **mutación a** |
| R7 | `identidad-multirol.api.test.ts` › T15 (409 + `SELECT`) |
| R8 | `identidad-multirol.api.test.ts` › T14 (contactos independientes) |
| R9 | `identidad-multirol.api.test.ts` › T31 (a); `identidad.service.test.ts` › "lanza 409…" · **mutación f** |
| R10 | `identidad.service.test.ts` › "lleva tenant_id explícito" · **mutaciones b, b+d** |
| R11 | `identidad.service.test.ts` › "ninguna consulta filtra `user` por email" |
| R12 | `propietarios.api.test.ts` › "si falla el perfil tras reutilizar la identidad, el user_role se deshace" |
| R13 | `identidad-multirol.api.test.ts` › T18 (3 tests) · **mutación e** |
| R14 | `identidad-multirol.api.test.ts` › T17 (3 tests); `identidad-por-documento-rls.test.ts` · **mutación b+d** |
| R15 | `rol-activo.api.test.ts` › T23 (5 tests) — cierra la deuda **D3** |
| R16 | `rol-activo.api.test.ts` › "devuelve un token nuevo con el rol elegido" |
| R17 | `rol-activo.api.test.ts` › T25 (403, sin token, sin revelar roles) |
| R18 | `rol-activo-guard.test.ts` › R18 (4 tests); `rol-activo.api.test.ts` › T24 · **mutación c** |
| R19 | `rol-activo.api.test.ts` › "la comprobación es contra la BASE, no contra el token" |
| R20 | `rol-activo-guard.test.ts` › R20 (2 tests); `rol-activo.api.test.ts` › T26 (4 tests) |
| R21 | `rol-activo.api.test.ts` › "la elección queda auditada con el rol" |
| R22 | `identidad-por-documento-rls.test.ts` (7 tests); `rol-activo.api.test.ts` › "un token que AFIRMA un rol ajeno no obtiene perfil"; `identidad-multirol.api.test.ts` › T17 · **mutación d** |
| R23 | `rol-activo.api.test.ts` › "el token con rol de cliente tampoco escribe" y T26 |
| R24 | `identidad-por-documento-rls.test.ts` › "el rol de la conexión NO es superusuario ni tiene BYPASSRLS" · **mutación d** |
| R25 | `init-sh-roles-db.test.ts` (4 tests) |
| R26 | `spec-identidad-siempre-nueva.test.ts` (5 tests) |
| R27 | `identidad.service.test.ts` › `nombresCoinciden` (5 tests); `identidad-multirol.api.test.ts` › "los espacios y las mayúsculas sí se absorben" · **mutación f** |
| R28 | `identidad-multirol.api.test.ts` › T31 (cuerpo accionable, sin documento) |
| R29 | `rol-activo-guard.test.ts` › R29 (2 tests); `rol-activo.api.test.ts` › "un token cuyo rol_activo no figura entre sus roles" |

---

## Estado final

- `./init.sh` → **exit 0**.
- `npm run test` → **452** (línea base 372, +80).
- `npm run test:db` → **71** (línea base 56, +15).
- **31 / 31 tasks** marcadas en `specs/identidad_multirol_cliente/tasks.md`.
- La lista blanca de `tests/ddl-en-tests.test.ts` **no se amplió**.
- `feature_list.json` **no se ha tocado**: la feature sigue en `in_progress` a
  la espera del reviewer.

## Decisiones abiertas que quedan sobre la mesa

1. **PA-5 (heredada del spec, sigue abierta).** Si la comparación de nombres
   debe plegar diacríticos (una línea en `normalizarNombre` más su test) y qué
   hacer con el orden de apellidos (cambio de modelo de datos, feature propia).
   Mientras tanto **R27 rige tal cual** y `Maria` ≠ `María`.
2. **El selector visual no existe.** Esta feature deja el contrato
   (`GET /auth/me` + `POST /auth/rol-activo`) y nada más. El portal del cliente
   (RF-AU2/AU4) **no está en `feature_list.json`**; el humano decide si abre la
   ficha. Hasta que exista, R18 no se puede demostrar sobre rutas de cliente
   (ver arriba).
3. **La ventana de revocación sigue abierta y es de la #27.** Un `rol_activo`
   emitido sigue valiendo hasta que el token expire aunque se revoque el rol.
   Está así por decisión del humano (PA-3) y esta feature no lo empeora.
4. **PA-2 caduca al llegar a producción.** La migración avisa de las identidades
   duplicadas y no las fusiona. Con datos reales hará falta una herramienta de
   fusión con criterio, que es feature propia.
