# Implementación — `project_scaffold` (feature #1)

- **Agente:** `implementer` (sesión de reanudación)
- **Fecha:** 2026-07-26
- **Ruta de trabajo:** `/home/randyb/Apps_Development/InmobiliariaManagementSystem`
- **Estado de la sesión:** **completada** — pendiente de `reviewer`
- **Estado en `feature_list.json`:** sigue en `in_progress` (no lo cambia el
  implementer)
- **Tasks:** 35 de 35 `[x]`
- **Requirements verificados:** **19 de 19**

---

## 1. Historial: el bloqueo anterior y cómo se resolvió

La primera sesión (2026-07-25) se detuvo en **T4** con la feature en `blocked`.
Dos causas, ambas de entorno, ambas ya levantadas:

| Bloqueo | Causa | Resolución (previa a esta sesión) | Verificado hoy |
|---|---|---|---|
| `npm install` imposible | El repositorio vivía en un montaje CIFS/SMB (`//192.168.0.184/ZimaOS-HD`) con `symlink=native`; el servidor no implementa esos reparse points, así que `ln -s` devolvía `ENOTSUP` y npm no podía enlazar ni `node_modules/.bin/*` ni los workspaces | Repositorio movido a disco local (`btrfs`) | `npm install` → 593 paquetes, `node_modules/.bin/{tsc,eslint,vitest,drizzle-kit,tsx,vite}` presentes y ejecutables |
| Sin Docker | No instalado | Docker **29.6.2** instalado con daemon activo | `docker info` responde; `test:db` levanta contenedores reales |

**Consecuencia de fondo:** `design.md` §10 había declarado como deuda —con
vencimiento en la feature #2— el test que aplica la migración inicial contra
PostgreSQL real, por ausencia de Docker. **Esa deuda queda cerrada en esta
feature** (ver §3.5 y §6).

Ningún artefacto de T1–T3 se dio por bueno: se recompilaron, se pasaron por
ESLint y se cubrieron con tests (§4). Dos de ellos hubo que corregirlos
(`apps/api/tsconfig.build.json` y los manifiestos, ver §5).

---

## 2. Qué se construyó

### 2.1 Raíz del monorepo

| Archivo | Task | Contenido |
|---|---|---|
| `package.json` | T1, T5 | npm workspaces (`apps/*`, `packages/*`), `private`, `engines.node >=20`, los 9 scripts de `design.md` §6 |
| `.nvmrc` | T1 | `20` |
| `tsconfig.base.json` / `tsconfig.json` | T2 | `strict: true` + `noUncheckedIndexedAccess`; `paths` de `@inmobiliaria/types` |
| `eslint.config.mjs` | T4 | Flat config ESLint 9 + typescript-eslint + Prettier. Incluye la regla de frontera entre paquetes y `no-console`/`no-explicit-any`/`eqeqeq` |
| `.prettierrc`, `.prettierignore` | T4 | Formato del código (la prosa de `docs/` y `specs/` queda fuera a propósito) |
| `vitest.config.ts` | T30 | Orquesta los 3 proyectos deterministas (`repo`, `api`, `web`) |
| `vitest.repo.config.ts` | T6 | Suite estructural del repositorio |
| `docker-compose.yml` | T22, T23 | PostgreSQL 16.4, Redis 7.4.0, MinIO `RELEASE.2024-09-13`; tags fijados, volúmenes nombrados, healthchecks, credenciales por `${VAR}` |
| `.env.example` | T23 | Todas las claves con placeholder `CHANGE_ME`; ningún valor real |
| `tests/` | T6, T7, T24, T28, T29 | 5 suites estructurales (52 tests) |

### 2.2 `apps/api` (NestJS 11)

`src/main.ts`, `src/bootstrap.ts`, `src/app.module.ts`, `src/app-version.ts`,
`src/config/` (Zod + `ConfigModule`), `src/common/errors/` (`AppError`,
`ConfigurationError`, `ResourceNotFoundError`), `src/common/filters/`
(`AllExceptionsFilter`), `src/common/cors/` (`buildCorsOptions`),
`src/database/` (cliente Drizzle perezoso, runner de migraciones),
`src/modules/core/` (`CoreModule` + `health/`), `drizzle/0000_init.sql` +
`drizzle/meta/_journal.json`, `drizzle.config.ts`, `vitest.config.ts`,
`vitest.db.config.ts`, `test/support/` (app de prueba, entorno, guarda de
Docker), `test/db/` (suite Testcontainers).

Decisiones que conviene que el reviewer vea:

- **`configureApp(app, config)` en `src/bootstrap.ts`.** Los tests de humo
  configuran la app con la MISMA función que `main.ts`. Si el CORS o el filtro
  vivieran sueltos en `main.ts`, los tests probarían una app distinta de la que
  se despliega.
- **El pool de PostgreSQL es perezoso.** `hasActiveDatabasePool()` existe para
  que un test demuestre que arrancar la app no abrió ninguna conexión (R14), en
  vez de inferirlo de que la petición devolvió 200.
- **El filtro de excepciones traduce por código de estado**, no por excepción.
  Así ningún texto del framework (`Cannot GET /x`) puede llegar al cliente por
  descuido; hay una aserción explícita de ello.

### 2.3 `apps/web` (React 19 + Vite 7)

`index.html`, `src/main.tsx`, `src/App.tsx`, `src/hooks/use-health.ts`,
`src/api/health-client.ts`, `vite.config.ts`, `vitest.config.ts`,
`src/test-setup.ts`, `src/__tests__/App.test.tsx`.

El shell tiene los tres estados explícitos (cargando / error / listo) que exige
`docs/conventions.md` para toda vista que consulte la API, y consume el
contrato desde `@inmobiliaria/types` por el alias del workspace.

### 2.4 `packages/types`

`HEALTH_ENDPOINT`, `HealthStatus` (con la lista blanca de R15 documentada en el
propio tipo) y `ApiErrorResponse`.

---

## 3. Verificación — comandos y salida real

### 3.1 `npm run lint`

```console
$ npm run lint
npm notice run inmobiliaria-management-system@0.1.0 lint
npm notice run eslint .
```

Sin hallazgos. Exit 0.

### 3.2 `npm run typecheck`

```console
$ npm run typecheck
npm notice run tsc --noEmit -p tsconfig.json && npm run typecheck --workspaces --if-present
npm notice run @inmobiliaria/api@0.1.0 typecheck
npm notice run tsc --noEmit -p tsconfig.json
npm notice run @inmobiliaria/web@0.1.0 typecheck
npm notice run @inmobiliaria/types@0.1.0 typecheck
```

Exit 0.

### 3.3 `npm run test` (suite determinista, sin Docker)

```console
 RUN  v3.2.7 /home/randyb/Apps_Development/InmobiliariaManagementSystem

 ✓ |repo| tests/migrations.test.ts (8 tests) 3ms
 ✓ |repo| tests/docker-compose.test.ts (14 tests) 12ms
 ✓ |api|  src/config/__tests__/app-config.test.ts (9 tests) 5ms
 ✓ |api|  src/__tests__/app-module.test.ts (2 tests) 42ms
 ✓ |api|  src/modules/core/__tests__/routes-surface.test.ts (3 tests) 55ms
 ✓ |api|  src/modules/core/health/__tests__/health.contract.test.ts (3 tests) 57ms
 ✓ |api|  src/common/cors/__tests__/cors-options.test.ts (4 tests) 54ms
 ✓ |repo| tests/monorepo-structure.test.ts (17 tests) 328ms
 ✓ |web|  src/__tests__/App.test.tsx (3 tests) 56ms
 ✓ |api|  src/database/__tests__/run-migrations.test.ts (7 tests) 3ms
 ✓ |repo| tests/tsconfig-strict.test.ts (7 tests) 392ms
 ✓ |api|  src/modules/core/health/__tests__/health.smoke.test.ts (2 tests) 50ms
 ✓ |repo| tests/eslint-effective.test.ts (6 tests) 378ms

 Test Files  13 passed (13)
      Tests  85 passed (85)
```

Ejecutada también con `DOCKER_HOST=unix:///nonexistent/docker.sock`: mismo
resultado, `13 passed / 85 passed`. Ninguna de estas suites toca contenedores.

### 3.4 `npm run build`

```console
npm notice run @inmobiliaria/types@0.1.0 build -> tsc -p tsconfig.build.json
npm notice run @inmobiliaria/api@0.1.0   build -> tsc -p tsconfig.build.json
npm notice run @inmobiliaria/web@0.1.0   build -> tsc --noEmit && vite build
vite v7.3.6 building client environment for production...
✓ 32 modules transformed.
dist/index.html                  0.34 kB │ gzip:  0.25 kB
dist/assets/index-BreoZo6h.js  194.21 kB │ gzip: 61.81 kB │ map: 915.08 kB
✓ built in 327ms
```

Y el artefacto compilado de la API se ejerció de verdad
(`node dist/main.js`, puerto 13000):

```console
$ curl -s -i http://localhost:13000/health | head -3
HTTP/1.1 200 OK
Vary: Origin
Content-Type: application/json; charset=utf-8

{"status":"ok","version":"0.1.0","uptime":3}

$ curl -s http://localhost:13000/no-existe
{"statusCode":404,"error":"RESOURCE_NOT_FOUND","message":"El recurso solicitado no existe.","timestamp":"2026-07-26T05:50:47.772Z","path":"/no-existe"}
```

### 3.5 `npm run test:db` — PostgreSQL real (deuda cerrada)

```console
$ npm run test:db
npm notice run @inmobiliaria/api@0.1.0 test:db
npm notice run vitest run --config vitest.db.config.ts

 RUN  v3.2.7 /home/randyb/Apps_Development/InmobiliariaManagementSystem/apps/api

 ✓ |api-db| test/db/migrations.db.test.ts (5 tests) 2604ms

 Test Files  1 passed (1)
      Tests  5 passed (5)
   Duration  3.63s
```

Los 5 tests, contra un contenedor `postgres:16.4-alpine` levantado por
Testcontainers:

1. aplica `0000_init.sql` y registra 1 entrada en `drizzle.__drizzle_migrations`;
2. deja disponibles las extensiones `pgcrypto` y `citext`;
3. `gen_random_uuid()` devuelve un UUID válido;
4. re-aplicarla es idempotente (sigue habiendo 1 entrada, sin error);
5. **el esquema `public` no contiene ninguna tabla** (R11 comprobado contra el
   motor, no contra el texto del SQL).

### 3.6 Stack de `docker-compose.yml` levantado de verdad

```console
$ docker compose --env-file <env-local> up -d --wait
 Container inmobiliaria-postgres-1 Healthy
 Container inmobiliaria-redis-1    Healthy
 Container inmobiliaria-minio-1    Healthy
```

Con ese stack en pie se ejecutó el comando de migración de R10:

```console
$ env -u DATABASE_URL npm run db:migrate
[db:migrate] Configuración inválida: revisa la(s) variable(s) de entorno DATABASE_URL. Es obligatoria para aplicar las migraciones.
(exit 1)

$ DATABASE_URL=postgres://…@localhost:55432/inmobiliaria npm run db:migrate
[db:migrate] Migraciones aplicadas correctamente.
```

Estado resultante consultado directamente en el motor:

```console
 extname
----------
 citext
 pgcrypto
 plpgsql
(3 rows)

 migraciones
-------------
           1

 tablename
-----------
(0 rows)
```

El stack se derribó con `docker compose down -v` al terminar. El archivo de
variables usado vivió fuera del repositorio (no se creó ningún `.env`).

### 3.7 `./init.sh`

```console
── 5. Lint, typecheck y tests ──────────────────────────
→ npm run lint
[OK]    lint pasa
→ npm run typecheck
[OK]    typecheck pasa
→ npm run test
 Test Files  13 passed (13)
      Tests  85 passed (85)
[OK]    test pasa

── 6. Resumen ──────────────────────────────────────────
[OK]    Entorno listo. Puedes empezar a trabajar.
EXIT=0
```

### 3.8 `npm run format:check`

```console
Checking formatting...
All matched files use Prettier code style!
```

---

## 4. Trazabilidad `R<n>` → test (`docs/verification.md` Nivel 5)

| R | Test concreto | Archivo | Verde |
|---|---|---|---|
| R1 | `el manifiesto raíz es privado y declara los workspaces` · `el workspace $ruta existe y se llama $nombre` (×3) · `el gestor de paquetes resuelve los tres workspaces` | `tests/monorepo-structure.test.ts` | ✅ |
| R2 | `el módulo raíz compone y la aplicación arranca` | `apps/api/src/__tests__/app-module.test.ts` | ✅ |
| R2 | `apps/api organiza el dominio bajo src/modules/ con core/ presente (R2)` | `tests/monorepo-structure.test.ts` | ✅ |
| R3 | `renderiza el título y el estado de carga…` · `muestra la versión cuando el servicio responde` · `muestra un estado de error explícito si la API falla` | `apps/web/src/__tests__/App.test.tsx` | ✅ |
| R3 | `apps/web tiene el shell de React y su script de build (R3)` + `npm run build` (§3.4, exit 0) | `tests/monorepo-structure.test.ts` | ✅ |
| R4 | `tsconfig.base.json mapea @inmobiliaria/types al paquete compartido` | `tests/tsconfig-strict.test.ts` | ✅ |
| R4 | `prohíbe importar otro paquete por ruta relativa` · `permite el alias del workspace` | `tests/eslint-effective.test.ts` | ✅ |
| R4 | El import de `@inmobiliaria/types` en `App.test.tsx` y en `health.service.ts` falla el typecheck si el alias no resuelve | `npm run typecheck` (§3.2) | ✅ |
| R5 | `%s resuelve a strict: true` (×6 tsconfigs, configuración **efectiva** vía `tsc --showConfig`) | `tests/tsconfig-strict.test.ts` | ✅ |
| R6 | `define el script "%s"` (×9) + `./init.sh` §5 con exit 0 | `tests/monorepo-structure.test.ts` / §3.7 | ✅ |
| R7 | `reporta error de severidad 2 ante una comparación laxa` · `reporta error ante \`console.log\` de debug` · `reporta error ante \`any\` explícito` · `no reporta errores sobre código válido` | `tests/eslint-effective.test.ts` | ✅ |
| R8 | `declara el servicio %s` (×3) · `ninguna imagen usa la etiqueta latest ni la omite` · `cada servicio tiene volumen nombrado y healthcheck` | `tests/docker-compose.test.ts` | ✅ |
| R9 | `todo valor sensible es una interpolación ${VAR}` · `las contraseñas usadas en command también son interpolaciones` · `%s está declarada en .env.example con un placeholder` (×5) · `.env.example no contiene valores reales` · `todas las variables interpoladas por el compose existen en .env.example` | `tests/docker-compose.test.ts` | ✅ |
| R10 | `existe el archivo de migración inicial` · `el script db:migrate está definido en la raíz y en apps/api` | `tests/migrations.test.ts` | ✅ |
| R10 | `aplica la migración inicial y registra su ejecución` · `deja disponibles las extensiones que declara` · `gen_random_uuid() funciona tras la migración` · `es idempotente: re-aplicarla no duplica ni falla` (**PostgreSQL real**) | `apps/api/test/db/migrations.db.test.ts` | ✅ |
| R10 | `devuelve la cadena de conexión cuando está definida` | `apps/api/src/database/__tests__/run-migrations.test.ts` | ✅ |
| R11 | `ninguna migración de esta feature crea tablas de negocio` · `la migración inicial se limita a preparar el esquema base` | `tests/migrations.test.ts` | ✅ |
| R11 | `NO crea ninguna tabla de negocio en el esquema public (R11)` (**contra el motor**) | `apps/api/test/db/migrations.db.test.ts` | ✅ |
| R12 | `el journal está ordenado, sin huecos ni duplicados` · `cada entrada del journal corresponde a un archivo .sql existente` · `ningún archivo .sql queda sin registrar en el journal` · `los tags no se repiten y el dialecto es postgresql` | `tests/migrations.test.ts` | ✅ |
| R13 | `responde 200 con status "ok" y la versión de la aplicación` (Supertest sobre la app NestJS real) | `apps/api/src/modules/core/health/__tests__/health.smoke.test.ts` | ✅ |
| R13 | `APP_VERSION coincide con la versión del manifiesto de apps/api` | `apps/api/src/__tests__/app-module.test.ts` | ✅ |
| R14 | `responde sin PostgreSQL, Redis ni MinIO levantados y sin abrir conexión` (aserción positiva `hasActiveDatabasePool() === false`) | `apps/api/src/modules/core/health/__tests__/health.smoke.test.ts` | ✅ |
| R14 | `importar el cliente de base de datos no abre ninguna conexión (R14)` | `apps/api/src/database/__tests__/run-migrations.test.ts` | ✅ |
| R15 | `devuelve exactamente las claves de la lista blanca, sin extras` · `no filtra entorno, credenciales ni identificadores de tenant` · `el servicio devuelve la misma forma que el endpoint` | `apps/api/src/modules/core/health/__tests__/health.contract.test.ts` | ✅ |
| R16 | `no registra ninguna ruta fuera de la lista blanca` (enumeración vía `DiscoveryService` del contenedor de Nest) · `una ruta inexistente devuelve 404 en español y sin traza de pila` · `un método no soportado tampoco filtra texto del framework` | `apps/api/src/modules/core/__tests__/routes-surface.test.ts` | ✅ |
| R17 | `aborta con ConfigurationError si falta %s, nombrándola` (×4) · `no aplica ningún valor por defecto cuando falta DATABASE_URL` · `el mensaje de error no revela el valor de la variable` | `apps/api/src/config/__tests__/app-config.test.ts` | ✅ |
| R17 | `aborta con ConfigurationError si falta DATABASE_URL` · `trata una DATABASE_URL en blanco como ausente` (runner de migraciones) | `apps/api/src/database/__tests__/run-migrations.test.ts` | ✅ |
| R18 | `produce una lista explícita de orígenes, nunca un comodín` · `rechaza una configuración construida a mano con "*"` · `rechaza una lista vacía en vez de degradar a "cualquier origen"` · `nunca responde con Access-Control-Allow-Origin: *` (sobre la app real) | `apps/api/src/common/cors/__tests__/cors-options.test.ts` | ✅ |
| R18 | `rechaza CORS_ORIGINS con comodín (R18)` | `apps/api/src/config/__tests__/app-config.test.ts` | ✅ |
| R19 | `el script test no invoca la suite de base de datos (R19)` + ejecución de `npm run test` con `DOCKER_HOST` inválido → 85 passed | `tests/monorepo-structure.test.ts` / §3.3 | ✅ |
| R19 | `falla con un motivo explícito cuando el runtime no está disponible` · `el mensaje dice que la suite NO se omite en silencio` · `no falla cuando el runtime responde` | `apps/api/src/database/__tests__/run-migrations.test.ts` | ✅ |

**19 de 19 requirements cubiertos por al menos un test ejecutable.**

---

## 5. Desviaciones respecto al `design.md` (y por qué)

1. **`vitest.workspace.ts` → `vitest.config.ts` con `test.projects`**
   (`design.md` §4). `vitest.workspace.ts` está deprecado en Vitest 3.2 y
   eliminado en la 4; la forma soportada es `test.projects`. Cambio de forma,
   no de fondo: siguen siendo suites separadas y `test:db` sigue en otro
   comando y otro archivo de configuración.
2. **`tsx` como dependencia adicional de `apps/api`** (no está en la tabla de
   `design.md` §12). El runner de `db:migrate` está escrito en TypeScript
   porque T27 exige abortar con `ConfigurationError` propio, no con el error
   crudo del driver; `drizzle-kit migrate` no permite eso.
3. **`vite-tsconfig-paths` descartado.** La sesión anterior lo había añadido
   como desviación; se ha eliminado de ambos manifiestos. El alias
   `@inmobiliaria/types` se declara explícitamente en cada `vite`/`vitest`
   config, que es determinista y no depende de cómo un plugin interprete el
   `baseUrl` heredado de `tsconfig.base.json`.
4. **`packages/types` compila a `dist` y `apps/api/tsconfig.build.json`
   neutraliza `paths`.** `design.md` §4 solo preveía `src/index.ts`. El paquete
   exporta también un valor en runtime (`HEALTH_ENDPOINT`), así que el `dist`
   de la API necesita resolverlo por `node_modules`. Typecheck y tests siguen
   apuntando al código fuente (sin build previo); solo el `build` depende del
   orden types → api → web, ya codificado en el script raíz.
5. **`src/app-version.ts` como constante, con test de sincronización.**
   `design.md` §7 dice "versión del `package.json` de `apps/api`". Leerlo en
   runtime obliga a resolver rutas distintas en `src/` y en `dist/`, y una
   sonda de liveness no debería tocar el sistema de archivos. La constante se
   valida contra el manifiesto en un test, así que no puede divergir.
6. **La regla de frontera de ESLint prohíbe rutas relativas que atraviesen
   `apps/` o `packages/`**, no "cualquier ruta relativa con `../../`". La
   versión amplia marcaba como error imports legítimos *dentro* del mismo
   paquete (p. ej. un test en `src/modules/core/health/__tests__/`). Cubre el
   caso que nombra R4; su límite está anotado abajo (§6).

Desviaciones menores ya cerradas: `@types/node` fijado a `^22` pese a que la
máquina corre Node 26, para no tipar contra APIs inexistentes en el
`engines.node >= 20` declarado (`design.md` §11.5).

---

## 6. Deuda y observaciones para el reviewer

1. **Deuda de `CHECKPOINTS.md` §C4: CERRADA.** El test de aplicación real de la
   migración ya no está diferido a la feature #2. Se ejecuta hoy (§3.5).
2. **Rama negativa de R19 (Docker ausente): verificada por inyección, no
   apagando el daemon.** Intenté simularla con
   `DOCKER_HOST=unix:///nonexistent/docker.sock`, pero Testcontainers resuelve
   el runtime por varias estrategias en cadena y cae de vuelta al socket real,
   así que **`test:db` pasó igualmente** y la simulación no demuestra nada. La
   guarda se verifica de forma determinista inyectándole una sonda que
   rechaza (`assertDockerDisponible`), y el `globalSetup` real usa esa misma
   función con `getContainerRuntimeClient`. Lo digo explícitamente en vez de
   presentar la prueba fallida como válida.
3. **Límite de la regla de frontera de ESLint.** Detecta rutas relativas que
   crucen `packages/` o `apps/` (el caso de R4: importar los tipos compartidos
   a mano). No detectaría un `../../web/src/App` entre apps hermanas, porque el
   literal no contiene esos segmentos. Cuando exista `apps/pwa` (feature #15)
   conviene endurecerla con `eslint-plugin-import` o límites por proyecto.
4. **Cabecera `X-Powered-By: Express`.** El artefacto compilado la emite. No es
   una violación de R15/R16 (que hablan del cuerpo y del enrutado) y añadir
   cabeceras de seguridad no está en este spec, así que **no lo he tocado**:
   lo dejo propuesto para la feature de endurecimiento HTTP (junto con Helmet)
   en lugar de inventarme el requirement aquí.
5. **`npm 12` bloquea los `postinstall` de `esbuild`, `@swc/core`, `ssh2`,
   `protobufjs` y `cpu-features`.** Se verificó que las bindings nativas cargan
   igualmente (usan paquetes opcionales por plataforma), y toda la suite pasa.
   No se ha aprobado ningún script de instalación: menos superficie de
   ejecución arbitraria durante `npm install`.
6. **`apps/pwa` no existe todavía** — es de la feature #15, tal como fija
   `design.md` §4. La estructura no lo impide.

---

## 7. Invariantes de seguridad (`CHECKPOINTS.md` §C7)

| Invariante | Estado en esta feature |
|---|---|
| Aislamiento por `tenant_id` | **N/A todavía, con frontera verificada.** No hay tablas de negocio; R11 lo comprueba por partida doble: sobre el SQL y sobre el motor (`public` sin tablas). La primera tabla y su RLS son de la feature #2 |
| RBAC en backend | **N/A, con superficie acotada.** El único endpoint es `GET /health`, público por definición. `routes-surface.test.ts` falla si aparece cualquier otra ruta, así que ningún endpoint puede colarse sin sus tres tests cuando existan roles |
| Auditoría | N/A (feature #4) |
| Integridad documental (SHA-256) | N/A (no hay documentos) |
| Datos personales en logs | ✅ El filtro de excepciones registra solo método, ruta, estado y código; el stack va al log del servidor, nunca a la respuesta |
| **Sin secretos en el repositorio** | ✅ `./init.sh` §4 verde. `docker-compose.yml` sin literales (test dedicado), `.env.example` con `CHANGE_ME`, credenciales de test inertes y documentadas como tales, `.gitignore` excluye `.env`, `*.key`, `*.pem`, `dist/` y `node_modules/`. `git status` confirma que no hay artefactos ni `.env` sin ignorar |

---

## 8. Estado para el `reviewer`

- `feature_list.json`: feature #1 sigue en **`in_progress`**. El implementer no
  la marca `done`.
- `specs/project_scaffold/tasks.md`: 35/35 en `[x]`; la sección de bloqueo de
  la sesión anterior se eliminó por no aplicar ya.
- `./init.sh` → **exit 0**.
