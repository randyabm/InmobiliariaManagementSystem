# Implementación — cierre de #5 `owner_tenant_profiles` (T50–T73)

> Segunda pasada de la feature #5. La primera (T1–T47) fue **rechazada** por el
> reviewer con cuatro hallazgos críticos
> (`progress/review_owner_tenant_profiles.md`). B2 y la puerta ya estaban
> cerrados (T48, T49, T53). Este documento cubre las **23 tasks** restantes.

## Línea base (antes de tocar nada)

`./init.sh` → **exit 0**. `npm run test`: 28 archivos, **269 tests**.
`npm run test:db`: 1 archivo, **26 tests**.

## Orden de ejecución (design.md §20.5)

| Paso | Tasks | Qué cierra |
|---|---|---|
| 1 | T50 T51 T52 | B1: escritura sobre `user` acotada al tenant |
| 2 | T54 T73 T55 T56 | D-8/D-12 esquema |
| 3 | T57 T58 T59 | D-8 aplicación: login por (codigo, email) |
| 4 | T69 T70 T71 T72 | D-9: el contacto se muda al perfil |
| 5 | T60 … T64 | B3/D-10: rol sin BYPASSRLS — **el conmutador** |
| 6 | T65 … T68 | re-verificación de §C7 con el rol real |

---

## Bitácora

_(se va rellenando a medida que avanza cada bloque)_

### Paso 1 — B1: escritura sobre `user` acotada al tenant (T50, T51, T52) ✅

- **T50** — `predicado-identidad.ts` (nuevo): `predicadoDePertenenciaAlTenant(n)`
  genera el `EXISTS`/`NOT EXISTS` sobre `user_role`, válido antes y después de
  la migración de D-8. Lo usan `actualizarContacto` de `propietarios.repository`
  y de `inquilinos.repository`, que pasan a devolver `number | null`
  (`null` = no había contacto que escribir; `0` = identidad ajena).
- **T51** — `exigirIdentidadDelTenant(filas)` en `propietarios.service.ts`,
  reutilizada por `inquilinos.service.ts`: `0` → `ResourceNotFoundError` (404).
  **No** se creó `IdentidadCompartidaNoEditableError` (R39 eliminado por D-8).
- **T52** — `clientes/__tests__/escritura-identidad.api.test.ts`, 4 casos.

**Prueba por mutación (exigida).** Sustituyendo el predicado por
`($n::uuid IS NOT NULL)` —siempre cierto— el test se pone **rojo** con
`expected 'Nombre Robado' to be 'Marta Homonima'`: el PATCH del tenant A
responde 200 y **reescribe de verdad** la fila de `user` del tenant B. Es
literalmente el defecto B1. Restaurado el predicado, verde.

Suite tras el paso 1: `test` 29 archivos / **273 tests**, lint y typecheck en verde.

### Paso 2 — D-8/D-12, esquema (T54, T73, T55, T56) ✅ — y T60 adelantada

Migración **`0007_identidad_por_tenant.sql`** (entrada 7 del journal):

- `tenant.codigo text NOT NULL UNIQUE` con `CHECK` de etiqueta DNS (3–63,
  `^[a-z0-9]+(-[a-z0-9]+)*$`) **y** la lista de reservados (R73, R75, R77);
  backfill determinista desde `nombre` con sufijo más bajo (R76), vía la
  función `tenant_codigo_desde_nombre(text)`.
- `user.tenant_id NOT NULL` + FK, con **aborto accionable** (R61) si alguna
  identidad tiene roles en más de un tenant —o en ninguno—, en vez de adivinar.
- `UNIQUE(email)` global → `UNIQUE (tenant_id, email)` (R59).
- `UNIQUE (id, tenant_id)` + **FK compuesta** `user_role(user_id, tenant_id)` (R60).
- Política `user_tenant_isolation` estándar: `USING` **y** `WITH CHECK` sobre
  `tenant_id`, sustituyendo la `FOR ALL` de `0003` (R49).
- **T55** `tenant_por_codigo(text) RETURNS uuid` `SECURITY DEFINER`, coincidencia
  exacta, `REVOKE ALL … FROM PUBLIC` (R52). El `GRANT EXECUTE` va en el
  procedimiento de provisión, que corre *después* de las migraciones porque el
  rol todavía no existe cuando esta se aplica (R46).

Aplicación y fixtures adaptados en la misma corrida, como pedía T54:
`identidad.service` inserta `tenant_id`; el predicado de T50 se simplifica a
`tenant_id = $n`; todas las semillas de `tenant`/`user` llevan `codigo` y
`tenant_id`; la identidad `multiTenant` —**irrepresentable** bajo D-8— se
sustituye por `tokenConRolAjeno` (token que declara dos tenants, base que solo
respalda uno), que prueba R33 de forma más fuerte.

Tests nuevos: `auth/__tests__/codigo-inmobiliaria.test.ts` (unitarios de R73–R75),
`test/db/backfill-codigo.db.test.ts` (R76 sobre datos preexistentes, aplicando
0000–0006, sembrando y aplicando 0007 después), bloques de `tenant.codigo` y
`tenant_por_codigo` en `migrations.db.test.ts`, y
`database/__tests__/identidad-rls.test.ts` (T56, 15 casos).

**Pruebas por mutación.**
1. `USING/WITH CHECK` de `user_tenant_isolation` → `(true)`: **5 tests rojos**
   (SELECT cruzado, INSERT ajeno, UPDATE ajeno, mudanza de tenant, sin contexto).
2. FK compuesta → FK simple sobre `user_id`: **2 tests rojos** (R60).
3. *Mutante equivalente detectado:* quitar solo el `WITH CHECK` explícito **no**
   pone nada rojo, porque PostgreSQL reutiliza el `USING` cuando el `WITH CHECK`
   falta y aquí los dos predicados son idénticos. Queda anotado: el `WITH CHECK`
   explícito de R49 aporta claridad y protege ante un cambio futuro del `USING`,
   pero **hoy no es observable**. No se ha inflado ningún test para fingir que sí.

Suite tras el paso 2: `test` 31 archivos / **311 tests**; `test:db` 2 / **56**.

### Paso 3 — D-8, aplicación: login por inmobiliaria (T57, T58, T59) ✅

- **T57** — `POST /auth/login` exige `codigo` (400 por forma, vía
  `CodigoDeInmobiliariaInvalidoError`), lo normaliza (R74), resuelve el tenant
  con `tenant_por_codigo` y consulta `user` **dentro de una transacción con
  `app.current_tenant` fijado** (R66). Se acabó la excepción de B4.3: el login
  ya no consulta con el pool crudo fuera de todo contexto.
  `GET /auth/me` recibe el mismo tratamiento —no estaba en ninguna task, pero
  sin él T61 lo habría dejado devolviendo 401 a todo el mundo—.
- **T58** — retirada de `vincularPorEmail`; `crearOVincularIdentidad` pasa a
  llamarse `crearIdentidad`. El JWT lleva `tenant_id` y los roles de su único
  tenant (R67).
- **T59** — `auth/__tests__/login-por-inmobiliaria.test.ts`: mismo correo en dos
  inmobiliarias (R65), 401 indistinguible (R64), 400 por forma (R63),
  normalización (R74) y R62.

**Prueba por mutación.** Sustituir `AND tenant_id = $2` de la consulta del login
por `($2 IS NOT NULL)` pone **9 tests rojos**, entre ellos "ninguna de las dos
autentica con el código de la otra" y "el 401 es indistinguible".

Suite tras el paso 3: `test` 32 archivos / **333 tests**; `test:db` 2 / **56**.

#### ⚠️ Contradicción del spec encontrada y resuelta (R62 / T58 frente a §7.4)

El titular de **R62** y el enunciado de **T58** dicen que la identidad es
"**siempre** nueva". Al pie de la letra eso rompe dos cosas:

1. **RF-C2 y `design.md` §7.4** — una persona puede ser propietaria **e**
   inquilina de la misma inmobiliaria con una sola identidad y dos `user_role`.
   Hay un test de #5 que lo cubre desde T36.
2. **La `UNIQUE (tenant_id, email)` de R59** — crear una segunda identidad con
   el mismo correo en el mismo tenant es una violación de unicidad (se observó:
   500 en `inquilinos.api.test.ts`).

El cuerpo del propio R62 acota la prohibición —*"NO DEBE consultar ni reutilizar
ninguna identidad existente **de otro tenant**"*— y `design.md` §20.4 la acota
igual: *"RF-C2 sigue siendo cierto dentro de un tenant […] pero deja de serlo
entre tenants"*. **Resuelto a favor del diseño:** se retira toda reutilización
**entre** inmobiliarias y se conserva la reutilización **dentro** de una,
acotada con `AND tenant_id = $2`. No es una decisión de producto nueva: es la
lectura que el propio spec fija en dos sitios. Queda para que el reviewer la
confirme o la rebata.

### Paso 4 — D-9: el contacto se muda al perfil (T69, T70, T71, T72) ✅

- **T69** — migración `0008_contacto_en_perfil.sql` (entrada 8):
  `perfil_propietario.email_contacto` y `.telefono_contacto` (NULL, D-5 sigue),
  `perfil_inquilino.email_contacto`; **copia** `user.email`/`user.telefono` al
  perfil y **solo entonces** impone el `NOT NULL` (R70), con aborto accionable
  si algún inquilino se quedara sin correo. `user.telefono` no se elimina: lo
  siguen usando los usuarios internos de la #3.
- **T70** — esquemas Drizzle, tipos compartidos, DTOs, repositorios y servicios.
  `DatosDeContacto` queda reducido a `nombre`. Al crear un cliente `user.email`
  es **NULL** y el correo va a `email_contacto` (R71). El PATCH deja de escribir
  contacto en `user`; `actualizarContacto` solo escribe ya `nombre`.
- **T71/T72** — `clientes/__tests__/contacto-en-perfil.api.test.ts` (12 casos),
  incluida la resolución de destinatario y canal **sin `JOIN` a `user`** (R72).

**Prueba por mutación.** Volviendo a pasar el correo a `crearIdentidad` —es
decir, reescribiéndolo en `user.email`— se ponen **2 tests rojos** (creación y
PATCH). El invariante de R71 se mide, no se declara.

**Anotado para la feature #10 (RF-N1):** el destinatario y el canal de una
notificación se toman de `perfil_inquilino.email_contacto` / `.celular` +
`medio_preferido_contacto`, y de `perfil_propietario.email_contacto` /
`.telefono_contacto`. **Nunca de `user`**, que es credencial y puede estar a
NULL —de hecho lo está en todo cliente registrado por la inmobiliaria—.

Suite tras el paso 4: `test` 33 archivos / **345 tests**; `test:db` 2 / **56**.

#### ⚠️ Decisión abierta que D-9 provoca (§7.4 / RF-C2 dentro de un tenant)

Hasta ahora, dos altas de la misma persona en la misma inmobiliaria compartían
identidad porque se deduplicaba por `user.email`. **R71 manda que `user.email`
quede NULL en los clientes**, así que en el momento del alta ya no queda ninguna
clave por la que reconocerla: quien se registre como propietario **y** como
inquilino de la misma inmobiliaria tendrá hoy **dos filas de `user`**.

- `design.md` §7.3 ya lo anticipaba —*"la deduplicación de identidad solo es
  posible cuando hay email"*—, así que es consecuencia derivada, no invento.
- §7.4 sigue siendo cierto en el **modelo** (probado: `user_role` admite ambos
  roles sobre una identidad), pero deja de producirlo el **flujo de alta**.
- Unificarlas exigiría deduplicar por `documento` dentro del tenant. **Ningún
  requirement lo pide** y no se ha implementado. Queda para el humano.

### Paso 5 — B3/D-10: el rol sin BYPASSRLS, **el conmutador** (T60–T64) ✅

- **T60** (adelantada al paso 2, ver más abajo) — `database/rol-aplicacion.ts`:
  `asegurarRolDeAplicacion(urlDeMigracion, credenciales)`, idempotente. Crea el
  rol `NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE LOGIN`, **revoca todo** y
  concede lo mínimo: `USAGE`; `SELECT/INSERT/UPDATE` en negocio;
  `SELECT/INSERT` en `audit_log`; `EXECUTE` en `tenant_por_codigo`;
  **`DELETE` en ninguna tabla**.
- **T61 — el conmutador.** `DATABASE_MIGRATION_URL` (rol privilegiado) y
  `DATABASE_URL` (rol de aplicación) separadas en `.env.example`,
  `docker-compose.yml`, `init.sh` (paso 4c nuevo) y `app-config.ts`, con
  `APP_DB_USER`/`APP_DB_PASSWORD`. `migrate.ts` lee `DATABASE_MIGRATION_URL` y
  provisiona el rol **después** de migrar (R46). `readDatabaseUrl` **rechaza**
  `DATABASE_URL` como sustituto, con su test.
- **T63** — `entorno-clientes.ts` levanta la app con la cadena del rol de
  aplicación. Los **cuatro** tests que creaban `app_test_user` a mano
  (`tenant-rls`, `auth-rbac`, `clientes-rls`, `audit-log`) usan ahora
  `asegurarRolDeAplicacion` y **conectan con ese rol** en vez de hacer
  `SET ROLE`. La lista blanca de `tests/ddl-en-tests.test.ts` **queda vacía**,
  como estaba previsto: solo sobrevive la inyección de fallos de R22.
- **T62** — `database/verificar-rol-de-aplicacion.ts`, invocado en `main.ts`
  antes de `listen`: si `rolsuper` o `rolbypassrls`, `ConfigurationError`
  accionable. `undefined` también aborta: "no lo sé" no es "está bien".
- **T64** — `database/__tests__/rol-aplicacion.test.ts` (12 casos) contra la
  base real: atributos del rol, no es dueño de ninguna tabla, sin `DELETE` en
  ninguna, sin `UPDATE`/`DELETE` en `audit_log`, idempotencia y fail-fast.

> **Reordenación dentro del bloque, y por qué.** El plan lista T62 antes de
> T63. Hacerlo así habría dejado la suite **roja entre dos tasks**: el fail-fast
> aborta el arranque con un rol privilegiado, y hasta T63 los tests levantaban
> la app justamente con ese rol. Se ejecutó **T61 → T63 → T62 → T64**. El
> invariante que el orden protege —*el login nunca queda roto y T61 es el único
> conmutador*— se respeta íntegro.

**Pruebas por mutación (las de §C7, las importantes).**

| Mutación | Efecto |
|---|---|
| `NOBYPASSRLS` → `BYPASSRLS` en la provisión | **19 tests rojos** en `identidad-rls` y `clientes-rls`: `SELECT *` sin `WHERE` devuelve filas de los dos tenants, el `INSERT` ajeno deja de fallar, la conexión sin contexto ve todo. |
| `GRANT … UPDATE` → `… UPDATE, DELETE` | **4 tests rojos**, entre ellos "NO tiene privilegio DELETE en NINGUNA tabla". |

Esa primera fila es la demostración de que **B3 está cerrado**: antes de T63 esa
misma mutación no habría puesto nada rojo, porque el rol ya era superusuario.

Suite tras el paso 5: `test` 34 archivos / **358 tests**; `test:db` 2 / **56**.

### Paso 6 — Re-verificación de §C7 con el rol real (T65, T66, T67, T68) ✅

- **T65** — `clientes/__tests__/aislamiento-rol-real.api.test.ts` (10 casos).
  Los 9 accesos cruzados siguen en 404 **y**, lo que es nuevo, una consulta
  **cruda sin `WHERE tenant_id`** lanzada por la conexión de la aplicación
  devuelve solo el tenant activo. Se comprueba además que la app y esa conexión
  usan el **mismo** rol, y que hay datos en las dos inmobiliarias (si una
  estuviera vacía, "solo veo los míos" sería trivialmente cierto). Incluye el
  caso de escritura cruzada sobre `user` de T52 con el rol real.
- **T66** — `audit-log.test.ts` gana el bloque de inmutabilidad **con el rol de
  aplicación**: no tiene privilegio de `UPDATE`/`DELETE` sobre `audit_log`, y la
  sentencia se rechaza por privilegio o por trigger. Las dos barreras se prueban
  por separado a propósito: el trigger protege también al rol privilegiado, y el
  privilegio protege antes de llegar al trigger.

**Prueba por mutación exigida por T66.** Comentando los dos `CREATE TRIGGER` de
`0006_auditoria_append_only.sql`: **4 tests rojos** en `audit-log.test.ts` y
**2 más** en `migrations.db.test.ts`. Antes de T53 esa misma mutación no ponía
nada rojo, porque el trigger lo fabricaba el propio test.

---

## Mapa de trazabilidad `R38..R77 → test concreto`

| R | Qué exige | Test que lo verifica |
|---|---|---|
| R38 | escritura sobre `user` acotada al tenant | `clientes/__tests__/escritura-identidad.api.test.ts`; `aislamiento-rol-real.api.test.ts` (rol real) |
| R39 | ~~409 identidad compartida~~ | **eliminado (D-8)** — no se implementó |
| R40 | trigger append-only desde una migración | `migrations.db.test.ts` "0006 deja los triggers…"; `ddl-en-tests.test.ts` |
| R41 | `audit_log` inmutable también para el dueño | `migrations.db.test.ts` "UPDATE y DELETE … incluso para el dueño"; `audit-log.test.ts` (bloque T66) |
| R42 | no se reescribe una migración aplicada | `ddl-en-tests.test.ts` "la migración 0004 no se edita" |
| R43 | rol sujeto a RLS, no dueño | `rol-aplicacion.test.ts` (atributos + no es dueño) |
| R44 | arranque abortado si evade el RLS | `rol-aplicacion.test.ts` → `exigirRolSujetoARls` (4 casos) |
| R45 | privilegios mínimos, sin `DELETE` | `rol-aplicacion.test.ts` (privilegios); `identidad-rls.test.ts` (DELETE denegado) |
| R46 | provisión única y repetible | `rol-aplicacion.test.ts` "reprovisionar no acumula"; la usan `db:migrate` y los 5 entornos de test |
| R47 | credenciales separadas | `run-migrations.test.ts` (incluido "NO acepta DATABASE_URL") |
| R48 | los tests HTTP corren con el rol de aplicación | `aislamiento-rol-real.api.test.ts` (rol de la conexión + mismo rol que la app) |
| R49 | política estándar en `user` | `identidad-rls.test.ts` (SELECT/INSERT/UPDATE/DELETE/sin contexto) |
| R50 | ~~motor impide reescribir identidad compartida~~ | **eliminado (D-8)** |
| R51 | el login funciona con RLS activo | `login-por-inmobiliaria.test.ts`; `login-tras-d5.test.ts` |
| R52 | única ruta previa al contexto de tenant | `migrations.db.test.ts` (`tenant_por_codigo`: exacta, SECURITY DEFINER, sin PUBLIC, **no hay otra**) |
| R53, R54 | ~~vinculación por email y su auditoría~~ | **eliminados (D-8)** |
| R55 | crear identidad no la bloquea ninguna política | `identidad-rls.test.ts` "INSERT con el tenant_id propio" |
| R56 | `test:db` en el semáforo | `init.sh` (T48) |
| R57 | ningún test fabrica lo que verifica | `ddl-en-tests.test.ts` — **lista blanca vacía** desde T63 |
| R58 | invariantes con el rol sin `BYPASSRLS` | `aislamiento-rol-real.api.test.ts`; `identidad-rls.test.ts`; `clientes-rls.test.ts`; `audit-log.test.ts` |
| R59 | `user.tenant_id` y unicidad por tenant | `migrations.db.test.ts` "la unicidad del correo pasa a POR TENANT"; `identidad-rls.test.ts` |
| R60 | el rol no apunta a otro tenant | `identidad-rls.test.ts` (FK compuesta, 3 casos) |
| R61 | la migración no adivina el tenant | bloque `RAISE EXCEPTION` de `0007`; `backfill-codigo.db.test.ts` aplica la migración sobre datos reales |
| R62 | la identidad de un cliente es siempre nueva | `login-por-inmobiliaria.test.ts` "el mismo correo … produce DOS identidades" |
| R63 | el login exige el `codigo`, 400 por forma | `login-por-inmobiliaria.test.ts` (11 casos) |
| R64 | 401 indistinguible | `login-por-inmobiliaria.test.ts` (mismo message/error/statusCode) |
| R65 | mismo correo en dos inmobiliarias | `login-por-inmobiliaria.test.ts` |
| R66 | el login corre con contexto de tenant | `auth.service.ts` + `login-por-inmobiliaria.test.ts` (mutación del filtro → 9 rojos) |
| R67 | el token lleva un solo tenant | `login-por-inmobiliaria.test.ts` "el token lleva el tenant y los roles de SU inmobiliaria" |
| R68 | contacto del propietario en su perfil | `contacto-en-perfil.api.test.ts` |
| R69 | contacto del inquilino en su perfil | `contacto-en-perfil.api.test.ts` (incluido el `NOT NULL` del motor) |
| R70 | el traslado no pierde datos | migración `0008` + `contacto-en-perfil.api.test.ts` |
| R71 | `user.email` es credencial, no contacto | `contacto-en-perfil.api.test.ts` (creación y PATCH) |
| R72 | el perfil basta para notificar | `contacto-en-perfil.api.test.ts` (consulta sin `JOIN` a `user`) |
| R73 | formato del `codigo` | `migrations.db.test.ts` (CHECK, 9 casos) + `codigo-inmobiliaria.test.ts` |
| R74 | normalización del `codigo` | `codigo-inmobiliaria.test.ts`; `login-por-inmobiliaria.test.ts` |
| R75 | códigos reservados | `migrations.db.test.ts` (8 casos) + `codigo-inmobiliaria.test.ts` |
| R76 | backfill determinista | `backfill-codigo.db.test.ts` (6 casos, sobre datos preexistentes) |
| R77 | el motor valida el código en cualquier alta | `migrations.db.test.ts` (CHECK + NOT NULL + UNIQUE) |

### Estado de #2, #3 y #4

Fueron revertidas a `in_progress` por el humano porque estaban `done` sobre
invariantes que no se cumplían en ejecución. Lo que las cerraba era R58, y ya
está demostrado:

- **#2 (RLS por tenant)** — `clientes-rls.test.ts` y `aislamiento-rol-real…`
  corren con el rol sin `BYPASSRLS`. Mutación: conceder `BYPASSRLS` pone 19
  tests en rojo.
- **#3 (auth/RBAC)** — el login corre bajo contexto de tenant (R66) y la
  política de `user` es la estándar (R49). `auth-rbac.test.ts` usa el rol real.
- **#4 (auditoría)** — el trigger lo instala `0006` y el rol de la app ni
  siquiera puede intentar la mutación. Mutación: comentar los `CREATE TRIGGER`
  pone 6 tests en rojo.

**No las marco `done`**: no es mi decisión y el reviewer no ha pasado todavía.

---

## Verificación final (T68)

```
npm run lint        OK
npm run typecheck   OK
npm run test        35 archivos / 372 tests    OK
npm run test:db      2 archivos /  56 tests    OK
npm run build       OK
./init.sh           exit 0
```

Línea base al empezar: 269 + 26. Ahora: **372 + 56** (+103 y +30).

`./init.sh` emite tres **WARN** —no fallos— porque el `.env` local es anterior a
T61 y aún no declara `DATABASE_MIGRATION_URL`, `APP_DB_USER` ni
`APP_DB_PASSWORD`. Es exactamente el aviso que el paso 4c nuevo existe para dar,
y es `warn` y no `fail` a propósito: `.env` está en `.gitignore` y es de cada
máquina, así que bloquear la puerta por él impediría trabajar sin aportar
seguridad. La barrera real de ese invariante es el fail-fast de arranque (R44),
que sí aborta.

## Resumen de tasks

**23/23 hechas** en esta sesión: T50, T51, T52, T54, T55, T56, T57, T58, T59,
T60, T61, T62, T63, T64, T65, T66, T67, T68, T69, T70, T71, T72, T73.
`specs/owner_tenant_profiles/tasks.md` no tiene ninguna `- [ ]` pendiente.

**Migraciones nuevas:** `0007_identidad_por_tenant.sql`,
`0008_contacto_en_perfil.sql` (entradas 7 y 8 del journal).

## Estado de la feature

Queda en **`in_progress`**. No la marco `done` ni toco #2/#3/#4: eso es del
reviewer y del leader.

## Contradicciones y decisiones que dejo abiertas

1. **T56 exigía un rol "provisionado por el helper" y el helper era T60**, dos
   pasos más adelante. Adelanté **solo T60** (crear el procedimiento), que es
   inerte; el conmutador siguió siendo T61, tal como manda `design.md` §16.
2. **T62 antes de T63 dejaba la suite roja entre dos tasks.** Ejecuté
   T61 → T63 → T62 → T64. El invariante de secuencia se respeta.
3. **"La identidad es siempre nueva" (titular de R62 y T58) contradice RF-C2 y
   `design.md` §7.4.** Resuelto a favor del diseño: la prohibición es de heredar
   identidades **de otro tenant**, como dicen el cuerpo de R62 y §20.4.
4. **D-9 deja el alta sin deduplicación de identidad dentro del tenant.** Al
   quedar `user.email` NULL (R71) no hay clave por la que reconocer a la misma
   persona. §7.3 lo anticipaba. Deduplicar por `documento` **no lo pide ningún
   requirement** y no lo he implementado. **Decisión pendiente del humano.**
5. **Mutante equivalente:** quitar el `WITH CHECK` explícito de la política de
   `user` no pone ningún test rojo, porque PostgreSQL reutiliza el `USING`
   cuando falta y ambos predicados son idénticos. Lo dejo anotado en vez de
   inflar un test para fingir que se detecta.
6. **`GET /auth/me` no tenía task** y T61 lo habría dejado devolviendo 401 a
   todo el mundo (consultaba `user` sin contexto de tenant). Lo pasé por
   contexto igual que el login. Si el reviewer prefiere que vaya en una task
   propia, es un movimiento de una función.
7. **PA-14 sigue abierta** (quién da de alta una inmobiliaria y le asigna su
   `codigo`). No he inventado ningún flujo de onboarding: el motor valida el
   código venga de donde venga, que es lo que R77 pide.
