# Design — `project_scaffold` (feature #1, fase 1a)

> Decisiones técnicas **previas** al código. Se apoya en
> `docs/architecture.md` y `docs/conventions.md`; aquí solo se documentan los
> puntos donde esta feature toca o roza esas fronteras.
> Fuente de producto: `docs/PRD.md` §11.1 (D1, D2) y §11.2.

---

## 1. Restricciones del entorno real (verificadas en esta máquina)

| Herramienta | Estado hoy | Consecuencia para el diseño |
|---|---|---|
| `node` | **v26.4.0** disponible | `engines.node: ">=20"`; se fija `.nvmrc`/`engines` y se documenta que la máquina de desarrollo va muy por delante de la LTS. |
| `pnpm` | **NO instalado** | Ver §2. Se elige **npm workspaces**. |
| `npm` | **12.0.1** disponible | Gestor de paquetes efectivo del MVP. |
| `corepack` | NO disponible | Descarta activar pnpm "gratis" vía corepack. |
| `docker` | **NO disponible** | Ver §9 y §10. Ningún criterio de verificación de esta feature puede depender de levantar contenedores. |

**Regla derivada, no negociable para el implementer:** todo lo que esta
feature declara verde DEBE poder demostrarse hoy, sin Docker. Lo que requiera
contenedores se entrega como artefacto versionado y se verifica en la
feature #2.

---

## 2. Decisión: gestor de paquetes → **npm workspaces**

El PRD §11.2 **no fija gestor de paquetes**: fija Node/TypeScript, NestJS,
React y Docker Compose. `init.sh` ya contempla ambos casos (prefiere `pnpm`,
cae a `npm` con `[WARN]`), y `docs/verification.md` usa `pnpm test` solo como
ejemplo ilustrativo de comando.

- **Elección:** `npm` (>=10) con `workspaces` nativos, sin instalar nada extra.
- **Motivo:** es el único gestor presente; añadir pnpm crearía una dependencia
  de entorno no exigida por el PRD y bloquearía la feature en una máquina que
  hoy no puede instalarlo (sin corepack).
- **Coste aceptado:** `node_modules` menos eficiente en disco y ausencia del
  aislamiento estricto de dependencias fantasma de pnpm.
- **Puerta de salida:** la migración a pnpm es de bajo costo (un
  `pnpm-workspace.yaml` + lockfile) mientras no se dependa de features
  exclusivas de npm. **Regla:** no se usarán `overrides` ni protocolos
  específicos de npm que dificulten esa migración.
- **Si el humano prefiere pnpm** (decisión abierta §11): queda registrada la
  dependencia de entorno `pnpm >= 9` a instalar en la máquina y en el CI, y
  el cambio se limita a los archivos de workspace y a los scripts raíz.

Los comandos documentados en el spec se escriben con `npm run <script>`.

---

## 3. Decisión: ORM y motor de migraciones → **Drizzle + drizzle-kit**

El PRD §11.2 deja el ORM como *"Prisma o Drizzle (a confirmar)"* y §11.4 lo
lista como **pendiente técnico**. Esta feature necesita cerrarlo porque el
criterio de aceptación 4 exige "una migración inicial versionada y un comando
para aplicarla".

- **Elección propuesta:** **Drizzle ORM** + `drizzle-kit` para generar
  migraciones **en SQL plano** versionadas en el repositorio.
- **Motivos (anclados en D2 y `docs/architecture.md`):**
  1. Las políticas RLS (`ALTER TABLE ... ENABLE/FORCE ROW LEVEL SECURITY`,
     `CREATE POLICY`) se escriben como SQL de primera clase en la misma
     migración que crea la tabla, tal como exige `docs/conventions.md`.
  2. El contexto de tenant de la feature #2 requiere ejecutar
     `SET LOCAL app.current_tenant` sobre **la misma conexión** de la
     transacción; Drizzle expone la transacción y la conexión de forma
     directa, sin capa intermedia que la reasigne.
  3. Migraciones = archivos `.sql` legibles y auditables por el reviewer.
- **Alternativa descartada: Prisma.** Mejor DX y tipado generado, pero (a) el
  DSL propio obliga a meter todo el RLS en bloques SQL "escapados" del
  esquema, con riesgo de divergencia entre `schema.prisma` y la realidad del
  motor; (b) el manejo del pool y de las transacciones interactivas hace más
  frágil garantizar que el `SET LOCAL` viaja en la misma conexión que la
  consulta, que es exactamente el invariante que no podemos arriesgar (D2).
  Se documenta como descartada; si el humano prefiere Prisma, esta feature se
  re-especifica antes de implementar.
- **Estado:** **decisión abierta pendiente de confirmación humana** (§11).
  Cierra el pendiente PRD §11.4 "ORM definitivo".

---

## 4. Estructura de carpetas resultante

```
/
├── package.json                 # workspaces + scripts raíz
├── package-lock.json
├── tsconfig.base.json           # strict: true, paths de workspace
├── eslint.config.mjs            # flat config compartida
├── .prettierrc
├── vitest.workspace.ts          # orquesta las suites de los workspaces
├── docker-compose.yml           # postgres + redis + minio (artefacto)
├── .env.example                 # claves sin valores reales
├── .nvmrc
├── apps/
│   ├── api/                     # NestJS + TypeScript
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vitest.config.ts     # suite unit/api (sin Docker)
│   │   ├── vitest.db.config.ts  # suite Testcontainers (gated)
│   │   ├── drizzle.config.ts
│   │   ├── drizzle/
│   │   │   ├── meta/_journal.json
│   │   │   └── 0000_init.sql
│   │   └── src/
│   │       ├── main.ts
│   │       ├── app.module.ts
│   │       ├── config/          # carga y validación de env
│   │       ├── common/          # filtro de excepciones, errores de dominio
│   │       ├── database/        # cliente Drizzle + runner de migraciones
│   │       └── modules/
│   │           └── core/
│   │               ├── core.module.ts
│   │               └── health/
│   │                   ├── health.controller.ts
│   │                   ├── health.service.ts
│   │                   └── __tests__/
│   └── web/                     # React + TypeScript (Vite)
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       └── src/
│           ├── main.tsx
│           ├── App.tsx
│           └── __tests__/
└── packages/
    └── types/
        ├── package.json         # name: @inmobiliaria/types
        └── src/index.ts
```

Cumple `docs/architecture.md`: `apps/api/src/modules/` con `core/` presente,
`packages/types` como único lugar de tipos compartidos. `apps/pwa` **no** se
crea aún (llega en la feature #15, `pwa_offline`); la estructura no lo impide.

---

## 5. Stack fijado por esta feature

| Capa | Elección | Origen |
|---|---|---|
| Backend | NestJS 11 + TypeScript 5 | PRD §11.2 |
| Frontend | React 19 + TypeScript + **Vite** | PRD §11.2 (build tool no fijado por el PRD; Vite por coherencia con la PWA de D5) |
| ORM/migraciones | Drizzle + drizzle-kit (SQL plano) | §3, cierra PRD §11.4 |
| Driver PG | `pg` (node-postgres) | Requisito de Drizzle; pool explícito para el `SET LOCAL` de la feature #2 |
| Tests | **Vitest** + **Supertest** | PRD §16.2 / §16.4 |
| Tests de BD | **Testcontainers** (suite aparte, gated) | PRD §16.2, D10 |
| Lint/format | ESLint 9 (flat config) + Prettier | `docs/conventions.md` |
| Infra local | Docker Compose: PostgreSQL 16, Redis 7, MinIO | PRD §11.2, D6 |

**Nota sobre Vitest + NestJS:** NestJS trae Jest por defecto. El PRD manda
Vitest, así que se configura Vitest con `unplugin-swc` para soportar
decoradores y `emitDecoratorMetadata`. Es una divergencia del scaffolding por
defecto de Nest, **intencional y anclada al PRD §16.2**.

---

## 6. Scripts (raíz del monorepo)

| Script | Qué hace | Requirement |
|---|---|---|
| `lint` | ESLint sobre todos los workspaces | R6, R7 |
| `format:check` | Prettier en modo verificación | — |
| `typecheck` | `tsc --noEmit` por workspace | R5, R6 |
| `test` | Vitest en todos los workspaces, **excluyendo** la suite de BD | R6, R19 |
| `test:db` | Vitest sobre la suite Testcontainers; **falla explícito si no hay Docker** | R19 |
| `build` | Build de `api` y `web` | R3 |
| `db:migrate` | Aplica las migraciones pendientes contra `DATABASE_URL` | R10 |
| `db:generate` | Genera una nueva migración SQL a partir del esquema | R10 |
| `dev` | Levanta `api` y `web` en modo desarrollo | — |

`init.sh` §5 ejecuta `lint`, `typecheck` y `test` — por eso `test` **no** puede
depender de Docker (R19).

---

## 7. Healthcheck y test de humo

**Endpoint:** `GET /health` — público, sin autenticación (aún no existe), sin
tocar PostgreSQL, Redis ni MinIO.

Firmas nuevas:

```ts
// apps/api/src/modules/core/health/health.service.ts
export interface HealthStatus {
  status: 'ok';
  version: string;   // versión del package.json de apps/api
  uptime: number;    // segundos desde el arranque del proceso
}

export class HealthService {
  getStatus(): HealthStatus;
}
```

- La lista blanca de claves de la respuesta es **exactamente**
  `['status', 'version', 'uptime']` (R15). Cualquier campo extra rompe el test.
- **Liveness vs readiness:** `/health` es *liveness* (R14). La sonda de
  dependencias (`/health/ready`, que sí consulta PostgreSQL/Redis/MinIO) se
  **difiere a la feature #2**, cuando exista conexión real y Docker para
  probarla.

**Test de humo:** arranca la aplicación NestJS real con
`Test.createTestingModule(...).createNestApplication()` y usa Supertest.
No hay mocks del framework: si el módulo raíz no compone, el test falla.

---

## 8. Configuración, errores de dominio y CORS

**Config:** un único módulo de configuración valida el entorno en el arranque
con un esquema (Zod). Variables requeridas mínimas: `NODE_ENV`, `PORT`,
`DATABASE_URL`, `CORS_ORIGINS`. `REDIS_URL` y las de MinIO se declaran en
`.env.example` pero **no** son requeridas todavía (nada las consume en esta
feature) — se marcan como opcionales para no bloquear el arranque (R17).

**Errores de dominio nuevos** (base para todo el proyecto,
`apps/api/src/common/errors/`):

```ts
export class AppError extends Error {}                    // raíz del dominio
export class ConfigurationError extends AppError {}       // R17
export class ResourceNotFoundError extends AppError {}    // → HTTP 404
```

Y un `AllExceptionsFilter` global que traduce a HTTP siguiendo
`docs/conventions.md`: mensajes **en español**, sin stack traces, sin SQL, sin
datos de otro tenant (R16). `ResourceNotFoundError` se introduce aquí porque
el 404 de ruta desconocida ya lo necesita, y las features #2/#3 lo reutilizan
para el 404 de recurso de otro tenant en vez de inventar otro error.

**CORS:** `app.enableCors({ origin: config.corsOrigins })` con lista explícita
desde `CORS_ORIGINS` (separada por comas). Está **prohibido** `origin: true` u
`origin: '*'` (R18). Es la base de "CORS por dominio de tenant" (D7, RF-INT4);
la resolución dinámica por tenant llega con la entidad Tenant (feature #2).

**Logs:** se configura el logger para incluir `request_id`; `tenant_id` se
añade en la feature #2. No se registran datos personales
(`docs/conventions.md`, Ley 1581 de 2012).

---

## 9. Estrategia de migraciones — y qué NO hace esta migración

- **Ubicación:** `apps/api/drizzle/` + `meta/_journal.json` (registro
  versionado y ordenado, R12).
- **Migración inicial `0000_init.sql`:** contiene únicamente
  `CREATE EXTENSION IF NOT EXISTS pgcrypto;` (para `gen_random_uuid()`) y, si
  se necesita, `citext`. **No crea ninguna tabla de negocio** (R11).
- **¿Habilita RLS? NO — y es deliberado.** `docs/conventions.md` exige que
  *toda tabla de negocio habilite RLS en la misma migración que la crea*. La
  forma de no violar esa regla en un andamiaje es **no crear tablas de
  negocio todavía**. La primera tabla de negocio (`tenant`) y su
  `ENABLE ROW LEVEL SECURITY` + `FORCE` son **de la feature #2
  `multitenancy_rls`**, junto con su test de aislamiento contra PostgreSQL
  real. R11 convierte esa frontera en un test que falla si el implementer se
  adelanta.
- **Forward-only:** las migraciones no se editan una vez aplicadas
  (`docs/conventions.md`); no se generan archivos `down`.
- **Comando:** `npm run db:migrate` ejecuta un runner que lee `DATABASE_URL` y
  aplica las pendientes; si `DATABASE_URL` no está definida, aborta con
  `ConfigurationError` (no con un stack trace de `pg`).

**Diferido a la feature #2 (dependencia de Docker):** aplicar realmente la
migración contra PostgreSQL y verificar idempotencia y RLS. El test existe
desde ahora en la suite `test:db`, pero esta feature **no** lo usa como
criterio de aceptación.

---

## 10. Estrategia de tests sin Docker (R19)

Dos suites separadas, deliberadamente:

| Suite | Comando | Requiere Docker | Contenido |
|---|---|---|---|
| Determinista sin infra | `npm run test` | ❌ | Estructura del monorepo, tsconfig strict, lint programático, parseo de `docker-compose.yml`, journal de migraciones, config/env, healthcheck con Supertest, 404, CORS, componente de `web` |
| Base de datos real | `npm run test:db` | ✅ | Aplicación de migraciones y (desde la feature #2) RLS con Testcontainers |

Reglas:
- `npm run test` **nunca** intenta abrir un contenedor. Si la suite de BD se
  incluyera y se "saltara en silencio", el verde sería falso — por eso está en
  otro comando y otro archivo de configuración.
- `npm run test:db` invocado sin Docker **falla con mensaje explícito**
  ("Docker no disponible: los tests de RLS requieren Testcontainers"), no
  reporta verde.
- `init.sh` sólo ejecuta `test`, por lo que sigue verde en esta máquina.

**Tensión declarada con `CHECKPOINTS.md` §C4** ("toda migración tiene un test
que la ejercita"): hoy ese test existe pero no puede correr aquí. Se declara
como deuda explícita cuyo vencimiento es la feature #2, que sí exige Docker.
El reviewer debe tratarlo como conocido, no como omisión.

---

## 11. Ambigüedades del PRD y decisiones abiertas (puerta humana)

1. **ORM definitivo (PRD §11.4).** Se propone Drizzle (§3). Requiere
   confirmación humana; si se elige Prisma, cambia §3, §9 y varias tasks.
2. **Gestor de paquetes.** El PRD no lo fija. Se propone npm workspaces (§2).
   Si el humano prefiere pnpm, queda registrada la dependencia de entorno
   `pnpm >= 9` (no instalable hoy sin red/corepack en esta máquina).
3. **Build tool del frontend.** El PRD dice "React + TypeScript" sin fijar
   bundler. Se propone Vite por coherencia con la PWA offline (D5).
4. **CI (RF-QA1, Gitea Actions/Forgejo).** No está en los criterios de
   aceptación de esta feature; se deja **fuera de alcance**. Si el humano lo
   quiere aquí, se añade como feature o como tasks extra.
5. **Node 26 en la máquina de desarrollo.** Muy por delante de la LTS
   soportada por NestJS/Vite. Se fija `engines: >=20` y se documenta el
   riesgo; si alguna dependencia rompe en Node 26, el implementer **para** y
   lo reporta en vez de parchear con flags.
6. **Nombre del scope npm.** Se propone `@inmobiliaria/*`
   (`@inmobiliaria/types`, `@inmobiliaria/api`, `@inmobiliaria/web`). El PRD
   no nombra el producto en clave técnica; es reversible pero toca imports.
7. **Versión de PostgreSQL/Redis/MinIO en `docker-compose`.** Se proponen
   `postgres:16`, `redis:7`, `minio` con tag fechado. El PRD no fija
   versiones; RLS funciona desde PG 9.5, no hay riesgo funcional.

Ninguna de estas ambigüedades es de **producto**, por lo que la feature no se
marca `blocked`: son decisiones técnicas que el humano confirma o corrige en
la puerta de aprobación.

---

## 12. Dependencias nuevas y su justificación (`CHECKPOINTS.md` §C3)

| Dependencia | Para qué | Anclaje |
|---|---|---|
| `@nestjs/*`, `reflect-metadata`, `rxjs` | Backend | PRD §11.2 |
| `react`, `react-dom`, `vite`, `@vitejs/plugin-react` | Frontend | PRD §11.2 |
| `typescript` | Lenguaje | PRD §11.2 |
| `drizzle-orm`, `drizzle-kit`, `pg` | ORM + migraciones versionadas | PRD §11.2, §3 |
| `zod` | Validación de configuración y DTOs en el borde | `docs/architecture.md` |
| `vitest`, `supertest`, `@testing-library/react`, `unplugin-swc` | Suite determinista | PRD §16.2 |
| `testcontainers`, `@testcontainers/postgresql` | Suite de BD real (gated) | PRD §16.2, D10 |
| `eslint`, `typescript-eslint`, `prettier` | Convenciones | `docs/conventions.md` |
| `js-yaml` (dev) | Parsear `docker-compose.yml` en los tests de R8/R9 | Evita validar YAML con expresiones regulares |

No se introduce Nx ni Turborepo: **alternativa descartada** — el orquestador
de tareas añade una capa de configuración y caché que un monorepo de 3
paquetes no justifica; los scripts raíz con `--workspaces` bastan y mantienen
`init.sh` simple. Se reevaluará si el tiempo de CI lo exige.

---

## 13. Cómo se verifica cada requirement

| R | Verificación concreta |
|---|---|
| R1 | Test estructural: los 3 workspaces declarados y resueltos |
| R2 | Test de arranque del `AppModule` + existencia de `src/modules/core/` |
| R3 | `npm run build -w apps/web` en 0 + test de render del shell |
| R4 | Typecheck importando `@inmobiliaria/types` en `api` y `web` + regla ESLint de imports |
| R5 | Test que lee cada `tsconfig` y exige `strict === true` |
| R6 | `./init.sh` §5 (lint, typecheck, test) |
| R7 | Test que corre ESLint sobre código inválido y espera error severidad 2 |
| R8 | Test que parsea `docker-compose.yml`: 3 servicios, sin `latest` |
| R9 | Test de interpolación `${VAR}` + existencia de claves en `.env.example` |
| R10 | Test estructural de migración y script; ejecución real → suite `test:db` (feature #2) |
| R11 | Test que rechaza `CREATE TABLE` fuera de la lista permitida en `0000_init.sql` |
| R12 | Test de consistencia journal ↔ archivos ↔ orden |
| R13 | Test de humo Supertest `GET /health` → 200 y forma del cuerpo |
| R14 | El mismo test corre sin PostgreSQL/Redis/MinIO levantados (caso real hoy) |
| R15 | Test de lista blanca exacta de claves de la respuesta |
| R16 | Test de enumeración de rutas + Supertest sobre ruta inexistente → 404 en español sin `stack` |
| R17 | Test de validación de configuración sin variable requerida → `ConfigurationError` |
| R18 | Test que inspecciona la configuración de CORS: nunca `*` |
| R19 | `npm run test` verde sin Docker; `npm run test:db` falla explícito sin Docker |
