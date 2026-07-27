# Implementación acotada — #5 `owner_tenant_profiles`: puerta (T48, T49) y triggers append-only (T53)

**Fecha:** 2026-07-27 · **Agente:** implementer · **Feature:** #5, `in_progress`
**Encargo del humano:** *solo* T48, T49 y T53. Todo lo demás (T50–T52, T54–T68)
queda **sin tocar a propósito**: depende de PA-8, PA-9, PA-10 y PA-11, que son
decisiones de producto todavía sin respuesta. Implementarlas ahora sería repetir
el defecto que estamos corrigiendo.

---

## 1. Tasks completadas

| Task | Qué se hizo | Cubre |
|---|---|---|
| **T48** | `npm run test:db` entra en el semáforo de `init.sh`, con la justificación escrita en el propio script | R56 |
| **T49** | `tests/ddl-en-tests.test.ts`: guard que prohíbe que un test fabrique el objeto de esquema que verifica, con lista blanca justificada | R57 |
| **T53** | Migración `0006_auditoria_append_only.sql`: función + triggers `BEFORE UPDATE` / `BEFORE DELETE` sobre `audit_log` | R40, R41, R42 |

Marcadas `[x]` en `specs/owner_tenant_profiles/tasks.md` (líneas 148, 150, 162).
**Ninguna feature se ha marcado `done`.**

## 2. Archivos

### Creados

```
apps/api/drizzle/0006_auditoria_append_only.sql
tests/ddl-en-tests.test.ts
```

### Modificados

```
init.sh                                             (T48 — run_script test:db)
apps/api/drizzle/meta/_journal.json                 (T53 — entrada idx 6)
apps/api/src/database/__tests__/audit-log.test.ts   (T53/T49 — deja de crear función y triggers)
apps/api/test/db/migrations.db.test.ts              (T53 — forma de los triggers + conteo derivado del journal)
tests/ci-flujo-trabajo.test.ts                      (T48 — test de R56)
specs/owner_tenant_profiles/tasks.md                (T48, T49, T53 → [x])
progress/current.md
```

**No se editó `0004_auditoria.sql`** (R42): `docs/conventions.md` prohíbe tocar
una migración aplicada y Drizzle la identifica por el hash del archivo. La
corrección de su afirmación falsa (línea 4: "trigger previene UPDATE y DELETE",
que nunca fue cierta) vive en la cabecera de `0006`, que declara textualmente
qué faltaba y por qué se corrige desde allí.

---

## 3. T53 — el hallazgo B2, arreglado de verdad

**El defecto.** `0004_auditoria.sql` habilitaba RLS y creaba las políticas de
INSERT/SELECT, pero **nunca creó el trigger**. El único sitio donde ese trigger
existía era el `beforeAll` de `audit-log.test.ts` (líneas 30–53), que lo
fabricaba justo antes de afirmar que `audit_log` era inmutable: verde por
construcción, e inexistente en producción desde la feature #4.

**El arreglo.**

1. `0006_auditoria_append_only.sql` crea `audit_log_prevent_mutation()` y los
   triggers `trg_audit_log_no_update` y `trg_audit_log_no_delete`. Idempotente
   (`CREATE OR REPLACE` + `DROP TRIGGER IF EXISTS`), forward-only, sin `down`.
2. `audit-log.test.ts` **ya no crea** ni la función ni los triggers. En su lugar
   hay un comentario que explica por qué, y un test nuevo que consulta
   `pg_trigger` y exige que los dos triggers existan y apunten a la función.
3. R41 (inmutable **también para el dueño**) se prueba en `test/db/`: la conexión
   que ejecuta el `UPDATE` y el `DELETE` es la del rol dueño de la tabla, que se
   salta el RLS. Si la inmutabilidad dependiera de una política, ese test pasaría
   sin ruido; con el trigger, falla como debe.

### Verificación de que el test se pone ROJO sin la migración

Comprobado ejecutándolo, no razonándolo. Se neutralizó el cuerpo de `0006`
(comentando la función y los dos `CREATE TRIGGER`, dejando el archivo y su
entrada de journal en su sitio) y se relanzaron ambas suites:

| Suite | Con `0006` | Con `0006` neutralizada |
|---|---|---|
| `audit-log.test.ts` (`npm run test`) | 7 verdes | **3 rojos** / 4 verdes |
| `npm run test:db` | 26 verdes | **falla** (exit 1) |

Los tres rojos son exactamente los que deben serlo: el que comprueba que los
triggers existen, el de `UPDATE` y el de `DELETE`. Después se restauró el
archivo íntegro y ambas suites volvieron a verde.

---

## 4. T49 — el guard anti-DDL

`tests/ddl-en-tests.test.ts` recorre los `*.test.ts` de `apps/api/**` **y**
`apps/api/test/support/**` (si no, bastaría con mover el DDL a un ayudante para
esquivarlo) y falla ante `CREATE TRIGGER`, `CREATE FUNCTION` (con o sin
`OR REPLACE`), `CREATE POLICY`, `CREATE ROLE` y `GRANT`.

Detalles que lo hacen difícil de burlar o de dejar podrido:

- **Se comprueba el nombre del objeto, no el archivo.** Un archivo exento para
  su trigger de inyección de fallos no queda exento para crear una política.
- **Se eliminan los comentarios de TypeScript antes de buscar.** Si no, el propio
  comentario de `audit-log.test.ts` que explica por qué ya *no* crea el trigger
  dispararía el guard.
- **Hay un test de que el escáner ve archivos**: si una ruta cambia, el guard no
  pasa en verde por no haber mirado nada.
- **Hay un test anti-entrada-caduca**: cada excepción debe seguir correspondiendo
  a DDL que existe de verdad. Cuando T63 quite los roles ad hoc, el guard
  obligará a retirar también su permiso.

**Comprobado que detecta de verdad:** se inyectó temporalmente un
`CREATE POLICY inventada …` y un `GRANT … TO colado` en
`run-migrations.test.ts`; el guard falló nombrando ambos. Restaurado después.

### Lista blanca actual (`EXCEPCIONES_JUSTIFICADAS`)

| Archivo | Objetos | Motivo | Se retira en |
|---|---|---|---|
| `propietarios.api.test.ts` | `fallar_insert_perfil`, `trg_fallar_insert_perfil` | Inyección de fallos del test de atomicidad de R22: el trigger es el *estímulo*, no el sujeto de la afirmación (nota de R57) | Permanente |
| `tenant-rls.test.ts` | `app_test_user` | **Deuda B3**: el rol sin privilegios se crea ad hoc; debe crearlo el procedimiento de provisión (R46) | T63 |
| `auth-rbac.test.ts` | `app_test_user` | Deuda B3, ídem | T63 |
| `clientes-rls.test.ts` | `app_test_user` | Deuda B3, ídem | T63 |
| `audit-log.test.ts` | `app_test_user` | Deuda B3. La función y los triggers ya **no** se crean aquí | T63 |

> Las cuatro entradas de `app_test_user` son deuda declarada, no un permiso
> silencioso: el hallazgo B3 (rol de aplicación sin `BYPASSRLS`) está asignado a
> T60–T64, fuera de este encargo. Se dejan visibles y con fecha de caducidad en
> vez de ampliar el alcance.

---

## 5. T48 — `test:db` en el semáforo

`init.sh` ejecuta ahora `run_script test:db` después de `lint`, `typecheck` y
`test`, con el porqué escrito en el propio script: los invariantes de seguridad
(RLS real, inmutabilidad de la auditoría, forma de las migraciones) no se pueden
demostrar sin PostgreSQL de verdad, viven fuera de `npm run test` y, mientras
estuvieron fuera de la puerta, cuatro tests de políticas RLS llevaban rotos
desde #2/#3 sin que nadie lo viera.

Sin escape de fallo: si Docker falta, `test/support/docker-guard.ts` hace fallar
la suite con un motivo explícito en vez de omitirla.

R56 tiene su propio test en `tests/ci-flujo-trabajo.test.ts`: `init.sh` invoca
los cuatro scripts y la línea de `test:db` no lleva `|| true`.

---

## 6. Trazabilidad `R<n> → test`

| Req | Test que lo cierra |
|---|---|
| **R40** — el trigger lo crea una migración | `test/db/migrations.db.test.ts` › «0006 deja los triggers append-only de audit_log instalados»; `audit-log.test.ts` › «los triggers append-only los instala la migración, no el test»; `tests/ddl-en-tests.test.ts` › «audit-log.test.ts ya no crea…» y «los triggers append-only los crea una migración versionada» |
| **R41** — inmutable también para el dueño | `test/db/migrations.db.test.ts` › «UPDATE y DELETE sobre audit_log fallan incluso para el dueño»; `audit-log.test.ts` › «UPDATE…» y «DELETE… (R6, R41)» |
| **R42** — no se reescribe una migración aplicada | `tests/ddl-en-tests.test.ts` › «la migración 0004 no se edita: la corrección va en la nueva» (exige que `0006` cite `0004_auditoria.sql`); `0004_auditoria.sql` intacto en `git status` |
| **R56** — `test:db` en el semáforo | `tests/ci-flujo-trabajo.test.ts` › «#5 R56 — init.sh incluye test:db en el semáforo» (4 casos + el de escape de fallo) |
| **R57** — ningún test fabrica lo que verifica | `tests/ddl-en-tests.test.ts` › «ningún test de apps/api crea triggers, funciones, políticas o roles», «encuentra archivos de test que escanear», «cada excepción sigue siendo necesaria» |

---

## 7. Estado de la verificación

| Comando | Antes | Después |
|---|---|---|
| `npm run lint` | verde | **verde** |
| `npm run typecheck` | verde | **verde** |
| `npm run test` | 257 tests / 27 archivos | **269 tests / 28 archivos**, todos verdes |
| `npm run test:db` | 24 tests / 1 archivo | **26 tests / 1 archivo**, todos verdes |
| `./init.sh` | **rojo** (exit 1) | **rojo** (exit 1) — misma causa, ver abajo |

### `./init.sh` está ROJO, y no por estas tasks

Único `[FAIL]` de la corrida:

```
[FAIL]  Hay 4 features en in_progress (máximo 1)
```

Todos los demás pasos pasan, `test:db` incluido. La causa es un estado de
`feature_list.json` **anterior a esta sesión y ajeno a estas tres tasks**:

- `git status` confirma que **no he tocado `feature_list.json`**; en `HEAD` ya
  figuran `2 multitenancy_rls`, `3 auth_rbac`, `4 auditoria` y
  `5 owner_tenant_profiles` en `in_progress`.
- Es consecuencia deliberada de la decisión del humano de revertir #2, #3 y #4 a
  `in_progress` (`design.md` §17), porque estaban `done` sobre invariantes que no
  se cumplían en ejecución.
- **No lo he "arreglado" a propósito.** Las tres vías de salida son cambiar
  estados de features (prohibido al implementer), cerrar #2/#3/#4 con T65/T66
  (fuera de alcance) o relajar la validación de `init.sh` (sería exactamente el
  defecto que este encargo corrige). **Decide el humano/leader.**

Salvo ese conteo, la puerta quedó **más estricta y verde**: `test:db` ahora se
ejecuta y pasa.

### Fallos que destapó la puerta más estricta

Ninguno inesperado. Al meter `test:db` en el semáforo, la suite ya estaba en
verde (24 tests) porque la sesión anterior arregló los 4 tests rotos de
`pg_policies`. El único cambio obligado fue el conteo de migraciones esperadas
(6 → 7); se sustituyó el número codificado a mano por el número de entradas del
journal, para que en adelante una migración sin registrar se vea aquí.

---

## 8. Lo que NO se hizo (y por qué)

- **T50, T51, T52** (filtro de exclusividad de identidad + 409): dependen de
  **PA-8** — de quién son los datos de contacto de una identidad compartida.
- **T54, T55, T56** (políticas por comando sobre `user` + funciones acotadas):
  dependen de **PA-9** y **PA-10** — qué ve un tenant de una identidad ajena y si
  se puede vincular sin consentimiento.
- **T57–T59, T60–T64, T65–T68**: van después en el orden no negociable de
  `design.md` §16, y T60–T64 arrastran **PA-11** (gestión de la credencial del
  rol de aplicación).

**Los hallazgos B1, B3 y B4 del reviewer siguen abiertos.** De los cuatro, solo
**B2 queda cerrado** en esta sesión. La deuda B3 está además explícitamente
inventariada en la lista blanca del guard, con la task que la retira.

## 9. Siguiente paso

1. El humano responde PA-8, PA-9, PA-10 y PA-11.
2. Se decide qué hacer con las 4 features en `in_progress` (init.sh rojo).
3. Se retoma en T50, siguiendo el orden de `design.md` §16.
