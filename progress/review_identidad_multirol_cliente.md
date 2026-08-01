# Review — feature #26 (`identidad_multirol_cliente`)

**Veredicto:** APPROVED

Revisor: agente `reviewer`. Fecha: 2026-08-01. HEAD revisado: `07b1083`.
Árbol de trabajo limpio antes y después de la revisión (las mutaciones se
aplicaron y revirtieron con `git checkout`; `git status --short` final vacío).

No he ejecutado la suite de línea base (verificada por el humano: `./init.sh`
exit 0, `test` 452, `test:db` 71). Lo que sí he ejecutado son **cinco
mutaciones**, para comprobar que los tests prueban lo que dicen probar.

---

## 1. Verificación por mutación — reproducida

Reproduje las cuatro que el humano pidió, más una propia. **Los cuatro números
del informe del implementer coinciden exactamente con los míos.**

| # | Mutación | Suite | Rojos declarados | Rojos **medidos** | ¿Coincide? |
|---|---|---|---|---|---|
| **b** | quitar `AND tenant_id = $3` (+ su parámetro) de `identidad.service.ts:128-129` | `npm run test` | 1 / 452 | **1 / 452** | ✅ |
| **b+d** | (b) + `BYPASSRLS` | `identidad-multirol.api.test.ts` | 2 / 19 | **2 / 19** | ✅ |
| **d** | `NOBYPASSRLS`→`BYPASSRLS` en `rol-aplicacion.ts:81` | `npm run test` | 37 / 452 | **37 / 452** | ✅ |
| **f** | `nombresCoinciden` → `return true` (`identidad.service.ts:201`) | `npm run test` | 9 / 452 | **9 / 452** | ✅ |
| **g** | *(mutación mía)* revertir `auth.module.ts` a `JwtModule.register({ secret: process.env.JWT_SECRET ?? 'dev-secret' })` | `npm run test` | — | **4 / 452** | — |

Control: `identidad-multirol.api.test.ts` sin mutar → 19/19 verde.

Rojos concretos, no meros conteos:

- **(b)** → `identidad.service.test.ts:110` «la búsqueda es por documento y
  lleva `tenant_id` explícito (R10)». Un solo test, el correcto.
- **(b+d)** → `identidad-multirol.api.test.ts:376` «la misma persona en A y en B
  produce DOS identidades distintas» y `:425` «un nombre distinto en la otra
  inmobiliaria NO dispara el 409 de R9». Son **exactamente** los dos tests de
  la frontera D-8.
- **(f)** → 4 de API en T31 + 5 unitarios (`:60` tildes, `:67` apellidos, `:74`,
  y los dos de T29 en `identidad.service.test.ts:198,229`).
- **(g)** → los 4 tests de `rol-activo.api.test.ts` T24 (`:163,182,199,214`).

---

## 2. El punto (b): ¿defensa en profundidad o hueco? — **razonamiento validado**

**Confirmo el razonamiento del implementer, y no encuentro hueco.** Argumento:

1. **R10 es un requirement de *forma*, no de efecto.** Su texto
   (`requirements.md:179-181`) dice literalmente que la consulta «DEBE incluir
   el `tenant_id` de la petición como predicado explícito, **además del**
   Row-Level Security». Un requirement sobre la forma de la consulta se verifica
   con un test sobre la forma de la consulta. Que produzca un solo rojo no es
   cobertura débil: es cobertura **exacta**.
2. **El test de forma no es trivialmente satisfacible.**
   `identidad.service.test.ts:125-126` exige `/tenant_id\s*=\s*\$\d/` **y**
   `expect(busqueda.parametros).toContain(TENANT_A)`. Un `AND tenant_id =
   tenant_id` decorativo no lo pasaría. El doble de `PoolClient` (`:30-44`)
   **registra** el SQL real emitido por el servicio; no fabrica el objeto que
   luego afirma.
3. **La propiedad de seguridad que D-8 protege sí está cubierta, y por partida
   doble.** El aislamiento efectivo lo demuestra el motor:
   `identidad-por-documento-rls.test.ts` (9 tests, rol sin `BYPASSRLS`, consultas
   crudas **sin** `WHERE tenant_id`) y T17 en la suite de API. La mutación (d),
   con 37 rojos incluidos los 7 de RLS, prueba que ese aislamiento no es
   decorativo.
4. **(b+d) cierra el argumento.** Que (b) sola dé 1 rojo y (b+d) dé 2 rojos en
   T17 es precisamente la demostración de que el predicado es la barrera que
   **sobrevive a un despliegue mal configurado**: en cuanto el motor deja de
   aislar, quitarlo reintroduce la vinculación entre inmobiliarias. Un
   invariante de defensa en profundidad cuya única cobertura fuera un test de
   forma sería sospechoso; aquí hay además la prueba de para qué sirve.

Lo que **sí** dejo anotado (deuda, no bloqueante): el par (b) y (b+d) debe
mantenerse en el informe. Si alguien borra el test de forma pensando «total, el
RLS ya aísla», el predicado queda sin quien lo sostenga. Está documentado en el
comentario del propio código (`identidad.service.ts:108-118`), que es el sitio
correcto.

---

## 3. El defecto del JWT (#3) — **real, grave, y bien arreglado**

**Confirmado, y era un defecto de verdad.**

- **Era real.** `git show 9c3b565` muestra el código anterior:
  `auth.module.ts` hacía `const JWT_SECRET = process.env.JWT_SECRET ??
  'dev-secret'` en el **cuerpo del módulo**, evaluado al importar el archivo.
  `jwt.strategy.ts:22-30` lee `process.env.JWT_SECRET` en el **constructor**.
  Dos momentos distintos → firma y verificación con secretos distintos en cuanto
  algo fije la variable entre medias, que es lo que hace el arnés de tests.
- **Nadie lo veía.** Verificado: los tests preexistentes que llaman a
  `POST /auth/login` (`login-por-inmobiliaria.test.ts:78`,
  `login-tras-d5.test.ts`) solo **decodifican** el payload en base64
  (`login-por-inmobiliaria.test.ts:109-111`) o miran el status. **Ninguno** usa
  el token emitido como `Authorization`. El defecto estaba fuera de alcance de
  la suite entera.
- **Está bien arreglado.** `registerAsync` con `useFactory`
  (`auth.module.ts:36-47`) difiere la lectura al instante de instanciar el
  módulo, y **elimina el `?? 'dev-secret'`**, lanzando si falta. Es la
  corrección correcta: un valor por defecto en la firma es peor que un fallo de
  arranque, porque produce tokens falsificables en silencio.
- **Y ahora hay tests que reutilizan un token emitido por la propia API.**
  `rol-activo.api.test.ts:192,207,224` toman `emitido.body.access_token` de
  `POST /auth/rol-activo` y lo mandan como `Bearer`. Mi mutación **(g)** lo
  confirma: revertir el arreglo pone esos 4 tests en rojo. El defecto ya **no**
  puede volver sin que la suite lo note.
- Matiz de forma (deuda, no bloqueante): la ruta de ida y vuelta que se ejercita
  es la de `POST /auth/rol-activo`, no la de `POST /auth/login`. Firman con el
  mismo `JwtService` y el mismo secreto, así que la regresión queda cubierta;
  aun así, un test que reutilice el token de `login` cerraría el caso literal
  descrito en el comentario `auth.module.ts:21`.

---

## 4. Los seis puntos autorreportados por el implementer

1. **R18 sin rutas de cliente — confirmado y suficiente.** No existe ninguna
   ruta con `@Roles('propietario')` o `('inquilino')`
   (`routes-surface.test.ts`: todas piden `admin`/`empleado`), y el portal
   (RF-AU2/AU4) no está en `feature_list.json`. Inventar un endpoint para poder
   probarse habría sido inventar producto. Las dos vías indirectas **sí**
   demuestran la propiedad de R18: (a) extremo a extremo sobre rutas reales con
   una identidad `empleado`+`propietario` — elegir `propietario` convierte
   `GET /propietarios` de 200 en 403 y el `POST` en 403 **sin escribir**
   (`rol-activo.api.test.ts:182-236`, verificado con `SELECT` en `:230-235`); y
   (b) en el guard, con los roles `propietario`/`inquilino` exactos y en las dos
   direcciones (`rol-activo-guard.test.ts:74-106`). La mutación **(c)** declarada
   (4 rojos: 2 de guard + 2 e2e) es coherente con esa estructura. Además la
   propiedad que R18 pide está garantizada **por construcción** en
   `roles.guard.ts:100-119`: `rolesEfectivos` es siempre `{rol_activo}` o
   `rolesDelTenant`, nunca un superconjunto. **R18 queda cubierto.** Anotado
   como deuda: reescribir el caso (a) con rutas de cliente cuando exista el portal.
2. **Test preexistente reescrito — legítimo, no esconde regresión.** El caso de
   `inquilinos.api.test.ts` afirmaba **el defecto** («dos filas de `user`»,
   documentado como deuda D5). El diff (`git show 7114b4a`) no relaja nada: pasa
   de `not.toBe` a `toBe` sobre el mismo `user_id`, mantiene `email IS NULL`
   (R71 de la #5 sigue vigente) y **endurece** la aserción de roles, que ahora
   comprueba `activo: true` además del nombre. También retira un `INSERT` manual
   de `user_role` que el test hacía para «demostrar que el esquema lo admite» —
   ya no hace falta, porque ahora lo hace el flujo real. Cambio correcto.
3. **Defecto del JWT — ver §3.** Real y bien arreglado.
4. **Listas blancas — confirmado.** `git diff ef464f3..HEAD -- tests/ddl-en-tests.test.ts`
   está **vacío**: la lista blanca anti-DDL no se tocó. Lo que se amplió es
   `RUTAS_PERMITIDAS` de `routes-surface.test.ts:22-27`, con **una** ruta
   (`POST /auth/rol-activo`) y su justificación. Son dos listas distintas y la
   correcta es la que se tocó. Igualmente, T16 usó
   `propietarios.api.test.ts`, ya exento en `EXCEPCIONES_JUSTIFICADAS`, en vez de
   pedir una exención nueva.
5. **Cambios en el spec de la #5 — solo texto.** `git show b7beac4` toca
   `requirements.md`, `tasks.md` y `design.md` de `owner_tenant_profiles` y nada
   más. Recuento de `[x]` en `specs/owner_tenant_profiles/tasks.md`: **73 antes
   y 73 después**; T58 sigue `[x]`. Ni una línea de código de la #5 modificada
   (`git diff --name-only ef464f3..HEAD` no incluye ningún archivo cuya
   modificación pertenezca a #5 salvo los que #26 legítimamente extiende). Las
   tres líneas extra son tablas-resumen que repetían la frase; dejarlas habría
   reintroducido la contradicción. Correcto.
6. **Código inalcanzable — retirado.** `buscarEnEsteTenant` por `email` ya no
   existe; `grep` sobre `apps/api/src` no devuelve ninguna referencia.
   `normalizarEmail` **no** quedó huérfana: se usa en `propietarios.service.ts:82,145`
   e `inquilinos.service.ts:69,113`. Sin huérfanos. C3 satisfecho.

---

## 5. Decisiones del humano — ninguna reinterpretada

| Decisión | Estado | Evidencia |
|---|---|---|
| 409 `NOMBRE_NO_COINCIDE_CON_IDENTIDAD` **sin escribir nada** | ✅ | `identidad-multirol.api.test.ts:259-274`: lo verifica con **tres `SELECT`** independientes (identidades, `user_role`, `count` de `perfil_inquilino`), no con el código de estado. El propio test lo dice: «El código de estado dice qué contestó la API, no qué quedó en la base». |
| Cuerpo con `user_id`, `nombre_registrado`, `nombre_recibido` | ✅ | `:228-243`, contra el `user_id` real capturado del alta previa. |
| Documento **fuera** del cuerpo | ✅ | `:245-257`, `expect(JSON.stringify(body)).not.toContain(DOCUMENTO)`. |
| Documento **fuera de los logs** | ✅ | `all-exceptions.filter.ts` `resolverDetalles`: los `detalles` van a la respuesta y **no** al log, y solo para `AppError` con status < 500. Auditoría: `auditoria-identidad.ts` mete `metadata: { rol }` y nada más; test en `identidad-multirol.api.test.ts:499`. |
| Comparación **estricta**, sin plegar tildes | ✅ | `normalizarNombre` (`identidad.service.ts:204-206`) hace `trim` + colapso + `toLowerCase`, **nada más**. Tests `identidad.service.test.ts:60` y `:67` fijan los dos no-casos. Mutación **f** los pone en rojo. |
| **No** se fusionan duplicados preexistentes | ✅ | `0009` avisa con `RAISE WARNING` y **no aborta**; `backfill-documento.db.test.ts` cubre «la identidad duplicada queda sin documento, no se fusiona». |
| #26 **no** implementa revocación | ✅ | No hay lista negra, ni refresh, ni logout en servidor. R19 se valida contra la base en la **emisión** (`rol-activo.api.test.ts:302-338`: revoca en base con el token intacto → 403). R29 solo comprueba coherencia interna, sin consultar la base (`roles.guard.ts:112-116`). Frontera con #27 respetada. |
| **D-8 intacto** | ✅ | T17 (3 tests, `:373-447`) + `identidad-por-documento-rls.test.ts` (9). Mutación **b+d** los pone en rojo. |

---

## 6. Trazabilidad requirements ↔ tests (29/29)

Verificada archivo por archivo; la tabla del implementer
(`progress/impl_identidad_multirol_cliente.md:211-241`) es fiel.

- R1, R2 [x] · R3 [x] · R4 [x] · R5 [x] · R6 [x] (mut. a) · R7 [x] · R8 [x]
- R9 [x] (mut. f) · R27 [x] (mut. f) · R28 [x] · R10 [x] (mut. b, b+d) · R11 [x]
- R12 [x] (`propietarios.api.test.ts`, inyección de fallo, sin ampliar exenciones)
- R13 [x] (mut. e) · R14 [x] (mut. b+d) · R15 [x] (cierra D3) · R16 [x] · R17 [x]
- R18 [x] (mut. c — ver §4.1) · R19 [x] · R20 [x] · R21 [x] · R29 [x]
- R22 [x] (mut. d) · R23 [x] · R24 [x] (mut. d) · R25 [x] · R26 [x]

**Anclaje al PRD:** los 29 citan `RF-*` (RF-C1..C6, RF-A1, RF-AU1, RF-AU6).
Ningún requirement sin origen en el PRD. Ningún producto inventado: donde no
había requisito (portal, fusión de duplicados, plegado de diacríticos) se paró y
se anotó como decisión abierta en vez de improvisar.

**Ningún test fabrica el objeto que dice verificar.** Revisado explícitamente:
el doble de `PoolClient` solo registra SQL; el rol de aplicación lo provisiona
`asegurarRolDeAplicacion` (el mismo de producción), nunca el test; las
aserciones de estado persistido usan `poolAdmin` con `SELECT` independientes.

## 7. Tasks completas

**31 / 31 `[x]`**, cero `[ ]` en `specs/identidad_multirol_cliente/tasks.md`.

## 8. Invariantes de seguridad (C7)

- **Aislamiento por tenant:** [x] — `0009` **no crea ninguna tabla** (verificado:
  sin `CREATE TABLE` en el archivo), así que no faltaba política: reutiliza
  `user_tenant_isolation` con `FORCE RLS` de `0007`, y eso se **verifica** en
  `identidad-por-documento-rls.test.ts` (9 tests, Postgres real vía
  Testcontainers, rol de aplicación sin `BYPASSRLS`), no se asume. Mutación (d):
  37 rojos.
- **Test de aislamiento contra Postgres real:** [x] — Testcontainers, nunca
  mocks. `:112` afirma explícitamente que el rol de la conexión **no** es
  superusuario ni tiene `BYPASSRLS`.
- **RBAC en backend con test de rechazo:** [x] — un endpoint nuevo
  (`POST /auth/rol-activo`), declarado en `RUTAS_PERMITIDAS`. Rechazo probado en
  T25 (403 sin token emitido) y en T24 (`:214` el POST no escribe, verificado
  con `SELECT`). El 403 se decide en el servidor, antes de tocar negocio.
- **Auditoría de acciones críticas:** [x] — `identidad.rol_anadido` (R13, mut. e)
  y `auth.rol_activo_elegido` (R21, `rol-activo.api.test.ts:238-264`). Ambas son
  acciones críticas de verdad: una credencial existente ganando un rol nuevo, y
  la elección del rol con el que se actúa.
- **Sin secretos hardcodeados:** [x] — barrido sobre todos los archivos tocados.
  Al contrario: la feature **elimina** el `?? 'dev-secret'`. `init.sh` §4 sigue
  vigilando.
- **Datos personales en logs:** [x] — el documento no aparece en el cuerpo del
  409, ni en el mensaje, ni en `metadata` de auditoría, ni en el log del filtro
  de excepciones. Tests dedicados para cada una de esas cuatro vías.
- **Integridad documental (SHA-256):** n/a — esta feature no toca documentos
  firmados; nada de lo existente se degrada.

## 9. Arquitectura y convenciones

- Fronteras respetadas: la regla de autorización vive en **un solo** punto
  (`roles.guard.ts`); `jwt.strategy.ts` propaga `rol_activo` sin interpretarlo.
  La auditoría de reutilización vive en `auditoria-identidad.ts`, una sola copia
  para los dos servicios de rol.
- Ningún módulo importa internals de otro. Ningún acceso a datos evade la capa
  de repositorio.
- Sin código muerto (§4.6). Sin `console.log`. SQL siempre parametrizado
  (afirmado además por test, `identidad.service.test.ts:129`).
- Frontera con **#25** y **#27** intacta: no se implementa revocación ni
  refresh; el claim `rol_activo` queda como punto de extensión de la #27.

## 10. Checkpoints

- C1 [x] · C2 [x] (con la salvedad D-2 de abajo) · C3 [x] · C4 [x] · C5 [x]
- C6 [x] · C7 [x] · C8 n/a

---

## Bloqueantes

**Ninguno.**

## Deuda anotada (no bloqueante, no impide cerrar #26)

- **D-1 —** `apps/api/vitest.config.ts:6-7` afirma que la suite «NO requiere
  Docker», pero varios `src/**/*.api.test.ts` levantan Testcontainers vía
  `levantarEntornoClientes`. **Es deuda preexistente de la #5** (introducida en
  `c8c69d1`), no de la #26, pero la #26 la amplía con dos archivos más. El
  comentario debería decir la verdad o los tests mudarse a `test/db/`.
- **D-2 —** `progress/current.md` conserva en cabecera «Feature en curso: #5
  `owner_tenant_profiles`» (línea 6) mientras la sesión de #26 está en la línea
  160. Basura de sesión anterior: es exactamente lo que C2 prohíbe. Lo arregla
  el leader al cerrar, no el implementer.
- **D-3 —** R18 seguirá sin demostrarse sobre rutas de cliente hasta que exista
  el portal (RF-AU2/AU4). Cuando se abra esa ficha, reescribir
  `rol-activo.api.test.ts` T24 con sus rutas.
- **D-4 —** Añadir un test que reutilice como `Bearer` el token de
  `POST /auth/login` (§3), para cerrar el caso literal del defecto de la #3.
- **D-5 —** El arreglo del JWT pertenece a la feature **#3**, ya `done`. Debe
  quedar constancia en el histórico del proyecto, no solo en el informe de la
  #26: es un defecto grave que estuvo en `main` sin que nadie lo viera.
- **D-6 —** PA-5 (plegado de diacríticos / orden de apellidos) sigue abierta por
  decisión del humano. Mientras tanto `Maria` ≠ `María` y el 409 se dispara.
- **D-7 —** PA-2: la migración avisa de identidades duplicadas y no las fusiona.
  Con datos reales hará falta una herramienta de fusión con criterio.

## Recomendación

**Cerrar #26 como `done`.** Es la implementación mejor verificada que he
revisado en este repositorio: los cuatro números de mutación se reproducen al
test exacto, las aserciones sobre estado persistido se hacen con `SELECT` y no
con códigos de estado, y los tres puntos donde el implementer podría haber
disimulado (el test preexistente que afirmaba el defecto, R18 sin rutas de
cliente, y el predicado `tenant_id` que solo rompe un test) están los tres
**reportados por él mismo antes de que nadie preguntara**, con el razonamiento
a la vista para poder rebatirlo. Los he rebatido y se sostienen.
