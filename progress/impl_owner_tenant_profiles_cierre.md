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
