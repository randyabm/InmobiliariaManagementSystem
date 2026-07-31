# Review #2 — feature #5 `owner_tenant_profiles`

- **Agente:** reviewer (segunda vuelta)
- **Fecha:** 2026-07-31
- **Informe anterior:** `progress/review_owner_tenant_profiles.md` (RECHAZADO, B1–B4)
- **Implementación revisada:** `progress/impl_owner_tenant_profiles_puerta.md` y
  `progress/impl_owner_tenant_profiles_cierre.md` (73/73 tasks)
- **Método:** lectura de artefactos + **mutación reproducida** sobre una copia
  desechable del repo (`scratchpad/mut`, con `node_modules` enlazado). El árbol
  de trabajo real **no se ha tocado** (`git status` limpio antes y después).
  No se repitió la suite completa: la verificó el leader (init.sh exit 0,
  372 + 56).

---

## VEREDICTO: **APROBADO**

Los cuatro hallazgos B1–B4 están cerrados **y verificados por mutación por mí,
no por el informe del implementer**. El aislamiento ya no lo sostiene el
`WHERE tenant_id` del repositorio: lo sostiene el motor, con un rol real sin
`BYPASSRLS`, y eso es reproducible en rojo.

Avalo cerrar **#5, #2, #3 y #4** (detalle en §6). Quedan cinco puntos de deuda,
ninguno bloqueante, listados en §7.

---

## 1. Los cuatro hallazgos de la primera vuelta

### B1 — Escritura cruzada sobre `user` — **CERRADO** (con matiz)

- Barrera de aplicación: `apps/api/src/modules/core/clientes/predicado-identidad.ts:33-35`
  (`"user"."tenant_id" = $n`), usada en `propietarios.repository.ts:198-200` e
  `inquilinos.repository.ts:160-162`. No queda ningún `UPDATE "user"` sin
  predicado en `apps/api/src` (grep exhaustivo: solo los dos citados y
  sentencias de test con el rol privilegiado).
- Barrera del motor: política `user_tenant_isolation` de
  `0007_identidad_por_tenant.sql:292-294` con `USING` **y** `WITH CHECK` sobre
  `tenant_id`, + `FORCE ROW LEVEL SECURITY` (`:297`).
- Traducción a 404: `propietarios.service.ts` (`exigirIdentidadDelTenant`).
- Tests: `clientes/__tests__/escritura-identidad.api.test.ts` (4 casos) y
  `clientes/__tests__/aislamiento-rol-real.api.test.ts`.

**Mutación reproducida.** Neutralizando **solo** el predicado del repositorio
(`($n::uuid IS NOT NULL)`): **0 tests rojos** — el motor sigue bloqueando la
escritura. Neutralizando **predicado + política** a la vez: **4 tests rojos**
(los 2 de `escritura-identidad` y 2 de `aislamiento-rol-real`, incluido *"ninguna
columna de esa identidad ajena cambió (verificado con SELECT)"*).

Es decir: el test **sí falla de verdad** cuando se rompe lo que protege, y quien
protege hoy es el motor —que es lo correcto—. **Matiz (deuda D1):** la capa de
defensa en profundidad del repositorio **no tiene cobertura propia**; se puede
borrar en silencio. El número "1(+1) rojo" del informe se midió en el paso 1,
antes de que existiera la barrera del motor; hoy ya no es reproducible y el
informe no lo advierte.

### B2 — Auditoría append-only fabricada por el test — **CERRADO**

- `apps/api/drizzle/0006_auditoria_append_only.sql:49-72`: función
  `audit_log_prevent_mutation()` + `trg_audit_log_no_update` /
  `trg_audit_log_no_delete`, `BEFORE`, idempotentes. `0004` **no** se reescribe
  (R42) y la cabecera mentirosa se corrige en la cabecera de `0006`,
  con justificación técnica (hash del migrador).
- El test ya no lo fabrica: `tests/ddl-en-tests.test.ts` prohíbe
  `CREATE TRIGGER/POLICY/FUNCTION/ROLE/GRANT` en los tests de `apps/api`, con
  **una** excepción justificada y permanente (inyección de fallos de R22).

**Mutación reproducida.** Comentando los dos `CREATE TRIGGER` de `0006`:
**4 rojos** en `audit-log.test.ts` (incluido *"los triggers append-only los
instala la migración, no el test"*) + **2 rojos** en `test/db/migrations.db.test.ts`
= **6**, exactamente lo que declara el informe.

### B3 — La app corría como superusuario — **CERRADO**

- `apps/api/src/database/rol-aplicacion.ts:78-84`:
  `ALTER ROLE … NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE LOGIN`, con
  `REVOKE ALL` previo y GRANT mínimos (`:88-118`); `DELETE` en ninguna tabla y
  `SELECT, INSERT` (nunca UPDATE/DELETE) en `audit_log` (`:99-105`).
- Fail-fast de arranque: `apps/api/src/main.ts:9,22`
  (`verificarRolDeAplicacion` antes de `listen`).
- Los entornos de prueba usan **ese mismo procedimiento**:
  `apps/api/test/support/entorno-clientes.ts:12,125` y los cuatro tests de
  `src/database/__tests__/` que antes creaban `app_test_user` a mano.
- Credenciales separadas: `.env.example:30,36,37,40`; `init.sh:160-185`.

**Mutación reproducida (la que sostiene el aislamiento).** `NOBYPASSRLS` →
`BYPASSRLS` en la provisión:

| Archivos | Rojos |
|---|---|
| `identidad-rls.test.ts` + `clientes-rls.test.ts` | **18** |
| `rol-aplicacion.test.ts` + `aislamiento-rol-real.api.test.ts` | **8** |
| `tenant-rls.test.ts` + `audit-log.test.ts` | **3** |
| **Total** | **29** |

El informe declara **19** en los dos primeros archivos; yo mido **18** ahí. La
discrepancia es de **un** test y va **a favor** del producto: la cobertura real
del invariante es mayor (29 en 6 archivos), no menor. No es un hallazgo.

Lo importante: entre los rojos están los **HTTP** de `aislamiento-rol-real`
(*"lo que filtra es el motor"*). Antes de T63 esa mutación no ponía nada rojo.
La objeción central de la primera vuelta —"los 404 miden el `WHERE`, no el
RLS"— queda resuelta.

### B4 — La política de `user` rompía identidades y login — **CERRADO**

- Política estándar en `0007:289-297`; `user` gana `tenant_id NOT NULL` + FK,
  `UNIQUE (tenant_id, email)` (R59), `UNIQUE (id, tenant_id)` y FK compuesta en
  `user_role` (R60).
- El login ya no consulta con el pool crudo fuera de contexto:
  `auth.service.ts:169-173` (`tenant_por_codigo`, `SECURITY DEFINER`, sin
  PUBLIC) → `BEGIN` + `app.current_tenant` → `:206-207`
  `SELECT … FROM "user" WHERE email = $1 AND email IS NOT NULL AND tenant_id = $2`.
- Verificado empíricamente que el login **y** `GET /auth/me` funcionan con el rol
  sujeto a RLS (sonda HTTP desechable contra el entorno real: `/auth/me` → 200
  con perfil y roles).

**Mutación reproducida.** `USING`/`WITH CHECK` de `user_tenant_isolation` →
`(true)`: **exactamente 5 rojos**, y son los cinco correctos —SELECT cruzado,
INSERT ajeno, UPDATE ajeno, mudanza de tenant y "sin contexto no se ve ninguna
identidad"—. Coincide con el informe.

---

## 2. Los siete puntos autorreportados

| # | Punto | Veredicto |
|---|---|---|
| 1 | T60 adelantada | **Justificado.** `rol-aplicacion.ts` es inerte hasta que alguien lo invoca; el conmutador siguió siendo T61. El invariante de secuencia es "el login nunca queda roto y T61 es el único conmutador", y se respeta. |
| 2 | T61 → T63 → T62 → T64 | **Justificado.** Con el orden del spec, el fail-fast de T62 habría abortado el arranque de una app que hasta T63 se levantaba con el rol privilegiado: suite roja entre dos tasks, que es justo lo que el orden pretende evitar. La reordenación sirve al invariante, no lo elude. |
| 3 | Contradicción R62/T58 | **Lectura correcta, confirmada.** El **cuerpo** de R62 (`requirements.md:681-686`) dice literalmente *"NO DEBE consultar ni reutilizar ninguna identidad existente **de otro tenant**"*, y `design.md` §20.4 lo acota igual. El titular es el que está mal redactado, no la implementación. Además, la lectura literal sería **inejecutable** contra `UNIQUE (tenant_id, email)`. Resolver a favor del diseño es lo correcto y quedó documentado, que es lo que se le pide a un implementer ante una contradicción. **Recomendación (no bloquea): corregir el titular de R62 en el spec** para que no vuelva a leerse mal. |
| 4 | Mutante equivalente del `WITH CHECK` | **Correcto.** PostgreSQL reutiliza el `USING` como `WITH CHECK` cuando este falta y aquí ambos predicados son idénticos: la mutación es semánticamente nula, no hay cobertura que falte. Anotarlo en vez de inflar un test es la conducta correcta. Deuda menor D2: si se quiere blindar, la aserción natural es de forma (`pg_policies.with_check IS NOT NULL`), no de comportamiento. |
| 5 | `GET /auth/me` sin task | **Alcance justificado, cobertura insuficiente.** El cambio era obligado (T61 lo habría dejado en 401 universal) y es una función. Pero `/auth/me` **no tiene ningún test funcional** en todo el repo: solo aparece en `routes-surface.test.ts:19` como superficie. Lo he ejercitado yo a mano y devuelve 200 correctamente, así que no hay defecto vivo; hay hueco de regresión. **Deuda D3**, no bloqueante (no es un `R<n>` de #5 ni un EARS de #3: en `specs/auth_rbac/requirements.md:174` figura como endpoint de ejemplo). |
| 6 | 3 WARN de `init.sh` | **WARN es la elección correcta.** `.env` está en `.gitignore` y es de cada máquina; un FAIL ahí bloquea a quien clona sin aportar seguridad, y la barrera real es el fail-fast de arranque (R44, `main.ts:22`), que sí aborta. **Matiz (D4):** el chequeo de `DATABASE_URL == DATABASE_MIGRATION_URL` (`init.sh:182-184`) sí describe una configuración inequívocamente rota; ese concreto merecería `fail`. No bloquea. |
| 7 | Lista blanca del guard anti-DDL | **Vaciada, confirmado.** `tests/ddl-en-tests.test.ts:43-52` conserva **una** excepción, la inyección de fallos de R22, declarada permanente y acotada por nombre de objeto. Las cuatro entradas de `tenant-rls`/`auth-rbac`/`clientes-rls`/`audit-log` desaparecieron y los cuatro archivos usan `asegurarRolDeAplicacion`. |

---

## 3. Trazabilidad y requirements retirados

- **73/73 tasks `[x]`**, ninguna `- [ ]` en `specs/owner_tenant_profiles/tasks.md`.
- **Los 5 requirements eliminados por D-8 (R25, R39, R50, R53, R54) están
  retirados, no huérfanos:** `vincularPorEmail` ya no existe;
  `IdentidadCompartidaNoEditableError` no se creó; no queda ningún test de
  vinculación entre tenants. Las únicas apariciones son comentarios que explican
  la retirada (`identidad.service.ts:26`, `propietarios.service.ts:189`) y notas
  en el spec. Correcto.
- R38–R77: mapa del informe verificado por muestreo contra el test citado, no
  contra el mapa. Los cuatro invariantes de §C7 se comprobaron por mutación,
  no por lectura.
- **Ningún test fabrica el objeto que verifica** — y ahora eso lo garantiza un
  test (R57), no la atención del revisor.
- **Fronteras intactas.** `0007` y `0008` no introducen ni una columna de
  retención/tarifa/porcentaje ni nada de propiedad, codeudor o referencias
  (grep limpio). `TABLAS_PERMITIDAS` sigue en 7 (`tests/migrations.test.ts:40-48`).

---

## 4. §C7 — invariantes de seguridad

| Invariante | Estado | Evidencia |
|---|---|---|
| Aislamiento por tenant | **[x]** | Rol `NOSUPERUSER NOBYPASSRLS` no dueño de ninguna tabla + `FORCE RLS` + políticas. **29 tests rojos** al conceder `BYPASSRLS`. Ya no es defensa en papel. |
| RBAC en backend | **[x]** | 403/401 en las 13 rutas desde `RolesGuard`; los tests HTTP corren ahora con el rol de aplicación real. |
| Auditoría inmutable | **[x]** | `0006` instala los triggers; el rol de la app ni siquiera tiene `UPDATE`/`DELETE` sobre `audit_log`. **6 rojos** al comentar los triggers. Doble barrera, probada por separado. |
| Integridad documental | **n/a** | Sin documentos firmados en esta feature. |
| Sin secretos hardcodeados | **[x]** | `.env.example` con `CHANGE_ME`; `docker-compose.yml` solo interpola; `migrate.ts:33` registra el **nombre** del rol, nunca la clave; la clave solo se interpola dentro del `ALTER ROLE` (`rol-aplicacion.ts:82`). |
| PII innecesaria en logs | **[x] con reserva** | Sin cambios adversos; sigue viva la reserva O3 de la vuelta anterior (`audit_log.actor_email`), permitida por la letra de R36. |

**CHECKPOINTS:** C1 [x] · C2 [x] · C3 [x] (salvo D5) · C4 [x] · C5 [x] ·
C6 [x] · C7 [x] · C8 n/a.

---

## 5. Lo mejor de esta vuelta

Que los invariantes ahora **se pueden poner en rojo**. En la primera vuelta el
verde no distinguía un sistema seguro de uno que solo lo parecía; hoy tocar
`NOBYPASSRLS`, la política de `user` o los triggers de `0006` derriba la suite
de forma inmediata y localizada. Eso es lo que convierte §C7 en verificación y
no en declaración.

---

## 6. Features que avalo cerrar

- **#5 `owner_tenant_profiles`** — **SÍ.** B1–B4 cerrados y verificados por
  mutación; 73/73 tasks; trazabilidad honesta; fronteras limpias.
- **#2 `multitenancy_rls`** — **SÍ.** Lo que la bloqueaba era que el RLS fuese
  inerte en ejecución. `tenant-rls.test.ts` y `clientes-rls.test.ts` corren con
  el rol real y se ponen en rojo con `BYPASSRLS` (verificado: 3 y 18 rojos).
- **#3 `auth_rbac`** — **SÍ.** La política de `user` es la estándar por
  `tenant_id`; el login corre dentro de contexto de tenant y funciona con el rol
  sujeto a RLS (verificado en ejecución, no solo por lectura); RBAC probado en
  backend. Se cierra **con la deuda D3** (`GET /auth/me` sin test funcional).
- **#4 `auditoria`** — **SÍ.** La inmutabilidad la impone una migración y la
  refuerza el privilegio del rol; 6 rojos al retirar los triggers.

---

## 7. Deuda registrada (ninguna bloquea)

- **D1 — La barrera de repositorio de B1 no tiene cobertura propia.**
  Neutralizar `predicadoDePertenenciaAlTenant` no pone nada en rojo: hoy la
  cubre el motor. Es defensa en profundidad borrable en silencio. Un test que
  ejercite el repositorio con un contexto de tenant permisivo la fijaría.
- **D2 — `WITH CHECK` explícito de R49 no observable** (mutante equivalente
  confirmado). Si se quiere fijar, aserción de forma sobre `pg_policies`.
- **D3 — `GET /auth/me` sin test funcional** (solo superficie de rutas), pese a
  haber cambiado en esta feature. Verificado a mano que devuelve 200. Un test
  HTTP en la próxima feature que toque auth.
- **D4 — `init.sh:182-184`**: `DATABASE_URL == DATABASE_MIGRATION_URL` es una
  configuración inequívocamente rota y hoy es `warn`; debería ser `fail`.
  Los tres WARN por variables ausentes, en cambio, están bien como WARN.
- **D5 — Código inalcanzable:** `identidad.service.ts:94-104`
  (`buscarEnEsteTenant`) no lo alcanza ningún llamador: `propietarios.service.ts:59`
  e `inquilinos.service.ts:46` invocan `crearIdentidad` con `{ nombre }`
  solamente, porque desde R71 el correo del cliente vive en el perfil. Es la
  otra cara de la decisión abierta nº4 del implementer: **dentro de un tenant ya
  no hay deduplicación de identidad**, así que quien sea propietario **e**
  inquilino de la misma inmobiliaria tendrá dos filas de `user`. §7.3 lo
  anticipaba y ningún requirement pide deduplicar por `documento`.
  **Decisión de producto pendiente del humano**, y hasta entonces conviene
  retirar el camino muerto (C3, `docs/conventions.md`).
- **D6 — Titular de R62 y enunciado de T58** dicen "siempre nueva" sin acotar
  "de otro tenant"; contradicen su propio cuerpo. Corregir el texto del spec.
- Siguen vigentes de la vuelta anterior: **O2** (fallback al header crudo en
  `audit.interceptor.ts`), **O3** (`actor_email`), **O4** (`AuditService.log`
  se traga errores), **O6** (`getProfile` ya tipa `email: string | null`, esta
  queda resuelta).
- **PA-14 abierta**: quién da de alta una inmobiliaria y asigna su `codigo`.
  Correctamente **no** inventado.

---

## 8. Nota para el humano

Esta es la vuelta en la que el proyecto pasa de "tiene RLS escrito" a "el RLS
lo aplica el motor y se nota cuando se rompe". Las cuatro features se cierran
sobre invariantes reproducibles: he puesto en rojo, a propósito, el rol, la
política de identidades, el filtro del login y los triggers de auditoría, y el
sistema se ha quejado en los sitios correctos.

Las dos únicas cosas que te tocan decidir a ti no bloquean el cierre: si se
deduplica o no la identidad por `documento` dentro de una inmobiliaria (D5) y
quién asigna el `codigo` de una inmobiliaria nueva (PA-14).
