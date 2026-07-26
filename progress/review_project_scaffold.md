# Review — feature #1 (`project_scaffold`)

**Veredicto:** APPROVED

- **Revisor:** `reviewer`
- **Fecha:** 2026-07-26
- **Ruta revisada:** `/home/randyb/Apps_Development/InmobiliariaManagementSystem`
  (confirmada: la copia en `/mnt/ZimaOS-HD/...` está **vacía**, `stat` da
  dispositivos distintos — no se leyó código muerto)
- **Estado en `feature_list.json`:** `in_progress` (el reviewer no lo cambia)

---

## 0. Verificación independiente (reejecutada, no aceptada por informe)

Todas las afirmaciones del implementer se reejecutaron. Ninguna resultó falsa.

| Comando | Resultado observado | Exit |
|---|---|---|
| `npm run lint` | sin hallazgos | **0** |
| `npm run typecheck` | raíz + 3 workspaces | **0** |
| `npm run test` | `Test Files 13 passed (13)` / `Tests 85 passed (85)` | **0** |
| `npm run test:db` | `Test Files 1 passed (1)` / `Tests 5 passed (5)`, Docker 29.6.2, `postgres:16.4-alpine` real | **0** |
| `npm run build` | types → api → web; `vite build` ✓ 32 módulos | **0** |
| `npm run format:check` | `All matched files use Prettier code style!` | **0** |
| `./init.sh` | §4 sin secretos + §5 lint/typecheck/test verdes | **0** |
| `DOCKER_HOST=unix:///nonexistent/docker.sock npm run test` | `Tests 85 passed (85)` | **0** |

Cifras del informe (85 tests / 13 archivos, 5 tests de BD) confirmadas exactamente.

### Tests de mutación (para descartar tests tautológicos)

No basta con que los tests pasen: se comprobó en una **copia aislada** del
repositorio (`scratchpad/mut`, el árbol real nunca se tocó) que fallan cuando el
comportamiento se rompe.

| # | Mutación introducida | Resultado esperado | Observado |
|---|---|---|---|
| M1 | `CREATE TABLE tenant (...)` en `0000_init.sql` | R11 falla | **1 failed** ✔ |
| M2 | `CREATE TABLE IF NOT EXISTS public."tenant"` (forma evasiva) | R11 falla | **1 failed** ✔ |
| M3 | `0001_orphan.sql` sin entrada en el journal | R12 falla | **1 failed** ✔ |
| M4 | restaurado | verde | 8 passed ✔ |
| M5 | `@Get('debug')` extra en `HealthController` | R16 falla | **1 failed** ✔ |
| M6 | `db: process.env.DATABASE_URL` en la respuesta de `/health` | R15 falla | **3 failed** ✔ |
| M8 | `strict: false` en `apps/web/tsconfig.json` | R5 falla | **1 failed** ✔ |
| M9 | anuladas las dos guardas de comodín CORS (Zod + `buildCorsOptions`) | R18 falla | **3 failed** ✔ |
| M10 | `globalSetup` de `test:db` con sonda de runtime que rechaza | `test:db` **falla**, no verde | **exit 1** + mensaje `Docker no disponible…` ✔ |

Conclusión: la suite es **sensible al comportamiento**, no decorativa. En
particular M1/M2/M5/M6 son los cuatro casos donde un test cosmético habría
dejado pasar un defecto de seguridad.

---

## 1. Trazabilidad requirements ↔ tests

Se comprobó, uno a uno, que el test citado **ejercita** lo que el requirement
afirma (no que un archivo exista).

- **R1** (PRD §11.2·D1): [x] `tests/monorepo-structure.test.ts` — no solo lee el
  manifiesto: `npm query .workspace --json` lee el árbol **instalado**, así que
  falla si un workspace no quedó enlazado.
- **R2** (PRD §11.2): [x] `app-module.test.ts` compila el `AppModule` real vía
  `Test.createTestingModule` + comprobación estructural de `src/modules/core/`.
- **R3** (PRD §11.2): [x] `apps/web/src/__tests__/App.test.tsx` (3 estados:
  carga / éxito / error, con `getByRole('alert')`) + `npm run build` exit 0
  reejecutado por mí. *Reparo menor: la mitad "build exit 0" no está en ningún
  gate automático (ver §5.2).*
- **R4** (architecture/conventions): [x] `tsconfig-strict.test.ts` (alias en la
  config **efectiva** vía `tsc --showConfig`) + `eslint-effective.test.ts`
  (regla de frontera ejecutada de verdad, caso positivo y negativo) + el
  `typecheck` rompería si el alias no resolviera.
- **R5** (conventions): [x] `tsconfig-strict.test.ts` sobre los 6 tsconfig con
  configuración **efectiva**, no el JSON literal. Mutación M8 lo confirma.
- **R6** (RF-QA1): [x] `monorepo-structure.test.ts` (9 scripts) + `./init.sh` §5.
- **R7** (RF-QA1): [x] `eslint-effective.test.ts` ejecuta ESLint
  programáticamente sobre 3 fragmentos que violan reglas activas y exige
  severidad 2, más un caso negativo. Es exactamente el control anti-falso-verde
  que pedía el requirement.
- **R8** (PRD §11.2·D6): [x] `docker-compose.test.ts` parsea el YAML con
  `js-yaml`; tags fijados (`postgres:16.4-alpine`, `redis:7.4.0-alpine`,
  `minio:RELEASE.2024-09-13T20-26-02Z`), volúmenes y healthchecks.
- **R9** (PRD §11.3·C7): [x] `docker-compose.test.ts` exige que **todo** valor de
  `environment` case con `/^\$\{[A-Z0-9_]+\}$/`, cubre `--requirepass` en
  `command`, y cruza las variables interpoladas contra `.env.example`
  (`CHANGE_ME`). Verificado a mano: el compose no tiene un solo literal.
- **R10** (PRD §11.2): [x] estructural (`migrations.test.ts`) **+ aplicación
  real** contra `postgres:16.4-alpine` con Testcontainers, incluida
  idempotencia. Sin mocks, sin SQLite.
- **R11** (conventions·D2): [x] **doble cobertura y ambas efectivas**:
  `migrations.test.ts` sobre el texto SQL con `TABLAS_PERMITIDAS = []`
  (mutaciones M1 y M2 la hacen fallar, incluida la forma
  `IF NOT EXISTS public."tenant"`), y `migrations.db.test.ts` contra el motor
  (`pg_tables WHERE schemaname='public'` = `[]`). El test exigido por el spec
  **es efectivo**: si el implementer se hubiera adelantado a la feature #2,
  falla por dos vías independientes.
- **R12** (conventions): [x] `migrations.test.ts` — journal ordenado, sin huecos
  ni duplicados, correspondencia 1:1 con los `.sql`. Mutación M3 lo confirma.
- **R13** (PRD §7·RF-QA1): [x] `health.smoke.test.ts` con Supertest sobre la app
  NestJS real + `APP_VERSION` sincronizado con el manifiesto.
- **R14** (PRD §7): [x] no se infiere del 200: hay **aserción positiva**
  `hasActiveDatabasePool() === false` con una `DATABASE_URL` que apunta a un
  host muerto. Es la forma correcta de probarlo.
- **R15** (RF-A1) *aislamiento*: [x] `health.contract.test.ts` compara el
  conjunto **exacto** de claves y busca fragmentos prohibidos. Mutación M6
  (filtrar `DATABASE_URL`) rompe 3 tests.
- **R16** (RF-A1·RF-C3) *superficie autorizada*: [x] `routes-surface.test.ts`
  enumera las rutas por `DiscoveryService` + metadata de Nest (no por una lista
  escrita a mano) y las compara con `['GET /health']`; 404 en español, sin
  `stack`, sin `Cannot GET`. Mutación M5 (ruta `debug` extra) lo rompe.
- **R17** (PRD §11.3·C7): [x] `app-config.test.ts` (4 variables × ausencia,
  nombre en el mensaje, sin default inseguro, sin filtrar el valor) +
  `run-migrations.test.ts` (`DATABASE_URL` en blanco tratada como ausente).
- **R18** (D7·RF-INT4): [x] `cors-options.test.ts` — lista explícita, rechazo de
  `*` y de lista vacía, **y** sobre la app real: origen permitido → eco exacto;
  origen ajeno → sin cabecera. Defensa en dos capas (Zod + `buildCorsOptions`),
  ambas necesarias (M9).
- **R19** (D10·PRD §16.2): [x] parcial pero suficiente — ver §5.1.

**19 de 19 requirements con al menos un test que falla si el comportamiento se
rompe.** Ningún test tautológico ni "el archivo existe" como única evidencia,
salvo los complementos estructurales de R2/R3, que van acompañados de tests de
comportamiento.

### Anclaje al PRD

Todas las referencias se contrastaron contra `docs/PRD.md`: `D1` (línea 618),
`D2` (619), `D7` (624), `D10` (627), `RF-A1` (96), `RF-C3` (154), `RF-INT4`
(187), `RF-QA1` (985), §7 (195), §11.2 (629), §11.3 (648). **Ningún requirement
inventa producto.** Los criterios de aceptación de `feature_list.json` mapean
1:1 con R1–R19. *Observación de forma:* R1, R2, R3, R8, R11, R12 y R14 se anclan
a secciones/decisiones del PRD (§11.2, §7, D1, D2) en vez de a un código `RF-*`
concreto, porque el PRD no numera el stack ni la disponibilidad como `RF-*`. El
origen es real y verificable, así que no es motivo de rechazo; se anota para el
`spec_author` (`CHECKPOINTS.md` §C6).

---

## 2. Tasks completas

35 de 35 en `[x]`. Se auditó una muestra amplia contra el árbol real, no contra
el informe:

- T1 [x] `package.json` raíz privado, workspaces, `engines >=20`, `.nvmrc`.
- T2 [x] `tsconfig.base.json` con `strict` + `noUncheckedIndexedAccess` + paths.
- T4 [x] `eslint.config.mjs` con `CROSS_PACKAGE_IMPORT_RULE`, `no-console`,
  `no-explicit-any`, `eqeqeq`. Verificado que **la regla realmente dispara**.
- T11 [x] `all-exceptions.filter.ts` traduce **por código de estado**, no por
  excepción — decisión correcta: ningún texto del framework puede filtrarse.
- T12 [x] `buildCorsOptions` prohíbe `*` y lista vacía; `origin: true` imposible
  por tipo (siempre `string[]`).
- T13 [x] `HealthService` no toca infraestructura; devuelve 3 claves.
- T22/T23 [x] compose auditado línea a línea: **cero literales**.
- T25 [x] pool perezoso, verificado con `hasActiveDatabasePool()`.
- T26 [x] `0000_init.sql` solo `CREATE EXTENSION pgcrypto/citext`.
- T27 [x] `readDatabaseUrl` lanza `ConfigurationError`, no error crudo del driver.
- T30/T31 [x] `vitest.db.config.ts` separado + guarda; comprobado que su fallo
  **aborta la suite con exit 1** (M10).
- T33 [x] `.gitignore` cubre `.env`, `.env.*` (con `!.env.example`), `*.pem`,
  `*.key`, `dist/`, `node_modules/`. `git status` limpio de artefactos.
- T34/T35 [x] `./init.sh` verde y el informe existe con el mapa de trazabilidad.

**Ninguna task marcada `[x]` está en realidad sin hacer.**

---

## 3. Invariantes de seguridad (`CHECKPOINTS.md` §C7) — verificados siempre

| Invariante | Estado | Evidencia comprobada por el reviewer |
|---|---|---|
| **Aislamiento por tenant / RLS** | [x] **N/A correctamente cerrado** | No hay ninguna tabla nueva: `0000_init.sql` solo crea extensiones. La frontera no se afirma, se **prueba**: contra el texto SQL (`TABLAS_PERMITIDAS = []`) y contra el motor real (`pg_tables` de `public` = `[]`). Mutaciones M1/M2 confirman que una tabla sin RLS haría fallar la suite. Es la forma correcta de no violar "toda tabla nueva habilita RLS en su migración": no crear tablas todavía. |
| **Test de aislamiento contra Postgres real** | [x] presente en su forma aplicable | `apps/api/test/db/migrations.db.test.ts` corre contra `postgres:16.4-alpine` levantado por Testcontainers. **Sin mocks ni SQLite.** Reejecutado por mí: 5 passed. El test de aislamiento canónico (tenant A ↛ tenant B) es de la feature #2, y sin tablas no puede escribirse hoy. |
| **RBAC en backend** | [x] **N/A con superficie sellada** | Único endpoint `GET /health`, público por definición. `routes-surface.test.ts` enumera el router real: cualquier endpoint futuro **rompe el test** hasta que se añada a la lista blanca con sus tres tests. Es un cerrojo, no una promesa. |
| **Auditoría** | [x] N/A (feature #4) | No hay acciones críticas: no hay dominio. |
| **Integridad documental SHA-256** | [x] N/A | No hay documentos. |
| **Datos personales en logs** | [x] | `AllExceptionsFilter` registra solo `método ruta -> estado código`; el stack va al log del servidor y **nunca** al cuerpo (aserción explícita). Sin datos de identidad. |
| **Sin secretos hardcodeados** | [x] | Barrido propio con grep sobre `apps/`, `packages/`, `tests/` y `docker-compose.yml`: **cero coincidencias**. `.env.example` solo `CHANGE_ME`. Credenciales de test (`test-password@127.0.0.1`) inertes y documentadas. `./init.sh` §4 verde. |

**Ningún invariante de C7 falla.**

---

## 4. Checkpoints

- **C1** [x] Arnés completo; `./init.sh` exit 0 (reejecutado).
- **C2** [x] Exactamente **una** feature en `in_progress` (#1); `progress/current.md`
  describe la sesión activa, sin basura.
- **C3** [x] Monolito modular respetado: solo `modules/core/`, controller sin
  lógica, ningún SQL fuera del runner de migraciones, sin dependencias
  circulares. Sin `console.log` de debug (solo `console.info/error` en la
  herramienta CLI `migrate.ts`, permitidos por la regla y justificados en
  comentario). Sin `any`, sin `@ts-ignore`, sin TODOs huérfanos, sin código
  muerto. Dependencias justificadas en `design.md` §12 (+ `tsx`, ver §5).
- **C4** [x] Cada módulo con lógica tiene test; la BD se prueba con **PostgreSQL
  real vía Testcontainers**; suite al 100%; **toda migración tiene test que la
  ejercita** — la deuda que `design.md` §10 difería a la feature #2 queda
  efectivamente **cerrada aquí** (verificado, no aceptado por informe).
- **C5** [x] Sin artefactos fuera del `.gitignore` (`dist/` ignorado, sin `.env`);
  `progress/history.md` existe; la feature está en su estado correcto.
- **C6** [x] `specs/project_scaffold/` con los 3 archivos; EARS; requirements
  anclados al PRD (ver matiz en §1); 35/35 tasks `[x]`; 19/19 con test.
- **C7** [x] Ver §3: ninguno falla.
- **C8** — no aplica (la feature no toca IA).

---

## 5. Evaluación de los puntos que el implementer declaró abiertos

### 5.1 Rama negativa de R19 verificada por inyección — **ACEPTABLE**

El implementer declara que no pudo simular la ausencia de Docker con
`DOCKER_HOST` inválido porque Testcontainers cae de vuelta al socket real, y
que verifica la guarda inyectando una sonda que rechaza. **Lo comprobé y su
descripción es exacta y honesta.** Además fui un paso más allá (M10): sustituí
la sonda del `globalSetup` real por una que rechaza y confirmé que
`npm run test:db` termina en **exit 1** imprimiendo `Docker no disponible…`, no
en verde ni en "skipped". Es decir: el cableado completo —guarda → `globalSetup`
→ código de salida— está verificado de forma determinista. El único eslabón no
demostrado es que `getContainerRuntimeClient()` rechace ante un daemon
realmente apagado, que es comportamiento de la librería, no del proyecto.
Exigir apagar el demonio de la máquina de desarrollo sería un requisito
desproporcionado. **Se acepta.** Vale más una limitación declarada que una
prueba falsa presentada como válida: el implementer hizo lo correcto al no
vender la simulación fallida como evidencia.

### 5.2 `X-Powered-By: Express` sin eliminar — **ACEPTABLE, se arrastra**

Correcto **no** tocarlo: R15 habla del cuerpo de la respuesta y R16 del
enrutado; ninguna cabecera de seguridad está en el spec, y añadirla habría sido
inventar requisito fuera del PRD, que es precisamente lo que el arnés prohíbe.
Es fuga de *fingerprinting* de bajo impacto sobre un endpoint público sin datos.
**No bloquea.** Se arrastra a la feature de endurecimiento HTTP (Helmet,
`disable('x-powered-by')`, HSTS, CSP), que debe crearse explícitamente en
`feature_list.json` en lugar de quedar como nota en un informe.

### 5.3 Las 6 desviaciones de `design.md` §5 — todas aceptables

1. **`vitest.workspace.ts` → `test.projects`** — **aceptada**. Obligada:
   `vitest.workspace.ts` está deprecado en 3.2 y eliminado en 4. No cambia el
   fondo: `test:db` sigue en comando y configuración aparte, que es la
   propiedad que R19 protege. Verificado que `npm run test` no arrastra
   contenedores (`grep` del script + ejecución con `DOCKER_HOST` inválido).
2. **`tsx` como dependencia extra de `apps/api`** — **aceptada**. Justificada:
   T27 exige abortar con `ConfigurationError` propio y `drizzle-kit migrate` no
   lo permite. Anotada como reparo menor abajo (está en `devDependencies`).
3. **`vite-tsconfig-paths` descartado** — **aceptada y mejor**. El alias
   explícito en cada config es determinista; menos magia que un plugin
   interpretando `baseUrl` heredado.
4. **`packages/types` compila a `dist` y `tsconfig.build.json` neutraliza
   `paths`** — **aceptada**. Necesaria porque el paquete exporta un valor en
   runtime (`HEALTH_ENDPOINT`), no solo tipos. Verificado que `npm run build`
   respeta el orden types → api → web y que typecheck/tests siguen apuntando a
   fuentes.
5. **`APP_VERSION` como constante con test de sincronización** — **aceptada y
   mejor que el diseño**. Una sonda de liveness que lee el sistema de archivos
   es peor idea; el test contra `package.json` impide la divergencia, que era
   el único riesgo.
6. **Regla de frontera ESLint acotada a rutas que cruzan `apps/`/`packages/`** —
   **aceptada con reserva**. Cubre el caso que nombra R4 y la versión amplia
   producía falsos positivos dentro del propio paquete. Su límite (no detecta
   `../../web/src/App` entre apps hermanas) está declarado por el implementer y
   se arrastra a la feature #15 (`apps/pwa`), cuando empiece a importar.

Todas están declaradas, razonadas y ninguna debilita un invariante de
seguridad. Ninguna exige corrección para cerrar esta feature.

---

## 6. Reparos menores (no bloquean el cierre)

1. **Idioma de los identificadores.** `docs/conventions.md` §Idioma dice "Código
   en inglés: nombres de variables, funciones, clases…". La superficie exportada
   lo cumple (`configureApp`, `buildCorsOptions`, `loadAppConfig`,
   `runMigrations`, `readDatabaseUrl`, `hasActiveDatabasePool`,
   `HealthService.getStatus`), pero los locales, helpers privados y toda la capa
   de test están en español: `resolverEstado`/`resolverCodigo`/`resolverMensaje`
   (`all-exceptions.filter.ts:84-98`), `origenes` (`cors-options.ts:20`),
   `MENSAJES_POR_ESTADO`, `crearAppDePrueba`, `usarEntornoDePrueba`,
   `enumerarRutas`, `archivosSql`, `TABLAS_PERMITIDAS`… Es sistemático y **no
   está declarado como desviación**. No bloquea (la convención no está
   automatizada y el borde público sí la respeta), pero **hay que decidirlo
   antes de la feature #2**: o se renombra a inglés, o se enmienda
   `docs/conventions.md` para permitir español en internals y tests. Si se deja
   sin decidir, se osifica en cuanto entre el dominio.
2. **`npm run build` no está en ningún gate.** `./init.sh` §5 corre
   `lint`/`typecheck`/`test`, no `build`. La mitad "build con exit 0" de R3
   depende hoy de que alguien lo ejecute a mano (lo hice: exit 0). Al no haber
   CI (fuera de alcance por decisión de `design.md` §11.4), una rotura del build
   de `apps/web` pasaría desapercibida. Debería entrar en el gate cuando se cree
   la feature de CI (RF-QA1).
3. **`db:migrate` depende de `tsx`, que está en `devDependencies`**
   (`apps/api/package.json`). Un despliegue con `npm ci --omit=dev` no podría
   aplicar migraciones. Hoy es inocuo (se migra en desarrollo y en CI), pero
   conviene apuntar el script al `dist/database/migrate.js` compilado cuando
   exista despliegue.
4. **`migrate.ts:22** vuelca el error crudo del driver (`console.error(..., error)`)
   ante fallos no-`AppError`. Un error de `pg` puede incluir la cadena de
   conexión con credenciales en la terminal o en el log de CI. Está justificado
   en comentario por ser herramienta de operación, pero conviene sanear la
   `DATABASE_URL` antes de imprimir.
5. **Comentarios sin tildes en `packages/types/src/health.ts`** ("Vive aqui",
   "ningun", "conexion", "publica"), a diferencia del resto del repositorio.
   Puramente cosmético.

## 7. Qué se arrastra a features posteriores

- **Feature #2 (`multitenancy_rls`)**: primera tabla `tenant` con
  `ENABLE`/`FORCE ROW LEVEL SECURITY` **en la misma migración**, test de
  aislamiento canónico (tenant A pide recurso de B → 404) contra PostgreSQL real,
  y `/health/ready` como sonda de dependencias. Al añadir el endpoint habrá que
  actualizar `RUTAS_PERMITIDAS` en `routes-surface.test.ts` **y** añadirle sus
  tres tests. Decidir además el punto 6.1 (idioma) antes de escribir dominio.
- **Feature #3 (`auth_rbac`)**: guards de rol en backend y los `403`/`404`
  canónicos que hoy solo existen como tabla de mensajes en el filtro.
- **Feature nueva a crear — endurecimiento HTTP**: `X-Powered-By`, Helmet, HSTS,
  CSP, rate limiting. No existe en `feature_list.json`; el `leader` debería
  proponerla al humano en vez de dejarla como nota.
- **Feature nueva a crear — CI (RF-QA1, Gitea Actions/Forgejo)**: `design.md`
  §11.4 la dejó fuera de alcance con acuerdo humano; sin ella, `lint`,
  `typecheck`, `test`, `test:db` y `build` no bloquean nada de forma automática.
- **Feature #15 (`apps/pwa`)**: endurecer `CROSS_PACKAGE_IMPORT_RULE` con
  `eslint-plugin-import` o límites por proyecto (desviación 6).

---

## 8. Cambios requeridos

**Ninguno bloqueante.** La feature #1 queda **APROBADA** y puede pasar a `done`.

Se trata de un trabajo de calidad notablemente alta: la trazabilidad no es una
tabla decorativa (nueve mutaciones independientes confirman que los tests
fallan cuando deben), la frontera con la feature #2 se protege por dos vías
—texto SQL y motor real—, la deuda de `CHECKPOINTS.md` §C4 se cierra de verdad
con PostgreSQL real, y las dos limitaciones se declararon en vez de disfrazarse
de evidencia. Los cinco reparos de §6 son de higiene y no comprometen ningún
invariante; el 6.1 (idioma) debe resolverse antes de que entre código de
dominio.
