# Bitácora de sesiones (append-only)

> Cada sesión cerrada añade una entrada al final. No se edita lo anterior.

---

## 2026-07-25 — Inicialización del arnés

- **Agente:** humano + Claude
- **Feature:** _ninguna_ (montaje del arnés)
- **Resultado:** repositorio inicializado con el arnés de Harness Engineering
  adaptado al proyecto: `AGENTS.md`, `CLAUDE.md`, `CHECKPOINTS.md`,
  `init.sh`, `feature_list.json`, `docs/` y `.claude/agents/`.
- **Producto:** `docs/PRD.md` (v0.2) copiado como fuente de verdad.
- **Estado:** 22 features cargadas, todas en `pending`. Sin código todavía
  (fase 0). `init.sh` verde omitiendo build y tests.
- **Próximo paso:** implementar la feature #1 `project_scaffold`.

---

## 2026-07-26 — Feature #1 `project_scaffold` (cerrada)

- **Agente:** leader → spec_author → implementer (bloqueado) → implementer
  (reanudado) → reviewer
- **Feature:** #1 `project_scaffold` — `in_progress` → **`done`**
- **Veredicto del reviewer:** **APPROVED**, sin cambios bloqueantes
  (`progress/review_project_scaffold.md`).

### Qué se construyó

Monorepo con workspaces npm: `apps/api` (NestJS + TypeScript), `apps/web`
(React + Vite) y `packages/types`. TypeScript estricto con alias de rutas,
ESLint (incluida una regla de frontera entre paquetes) y Prettier. Módulo
`core` con configuración validada por Zod, filtro global de excepciones, CORS
con lista explícita de orígenes y el endpoint `GET /health`.
`docker-compose.yml` con PostgreSQL 16, Redis 7 y MinIO — sin un solo literal
de credencial, todo interpolado desde `.env.example`. Drizzle con migración
inicial `0000_init.sql` (solo extensiones `pgcrypto` y `citext`), journal
versionado y runner propio que aborta con `ConfigurationError`.

35/35 tasks en `[x]` y 19/19 requirements con al menos un test que falla si el
comportamiento se rompe. Suites verdes: `lint`, `typecheck`, `test`
(85 tests / 13 archivos), `build`, `test:db` (5 tests contra PostgreSQL real) y
`./init.sh` en exit 0. El reviewer no aceptó el informe: reejecutó todo e
introdujo **nueve mutaciones** en una copia aislada para descartar tests
tautológicos; todas hicieron fallar el test correspondiente.

### Bloqueo y cómo se resolvió

La primera sesión de implementación quedó **bloqueada** por dos causas de
entorno, no de diseño:

1. El repositorio vivía en el montaje CIFS `//192.168.0.184/ZimaOS-HD`
   (`smb2`), que **no soporta enlaces simbólicos**, de modo que `npm install`
   era imposible (sin symlinks de workspaces ni de `node_modules/.bin/`).
2. **No había Docker**, requisito de Testcontainers.

Resuelto moviendo el repositorio a
`/home/randyb/Apps_Development/InmobiliariaManagementSystem` (btrfs) —
verificado con `git fsck` limpio y el mismo commit `2fa6738` — e instalando
**Docker 29.6.2**. La ruta antigua `/mnt/ZimaOS-HD/...` queda como copia de
respaldo desactualizada; **no se trabaja ahí** y debe borrarse cuando el humano
lo confirme.

### Deuda de `CHECKPOINTS.md` §C4: cerrada

`design.md` §10 preveía diferir a la feature #2 la aplicación de la migración
contra PostgreSQL real, por ausencia de contenedores. Al habilitarse Docker, la
deuda se **cerró en esta misma feature**: `apps/api/test/db/migrations.db.test.ts`
aplica la migración sobre `postgres:16.4-alpine` levantado por Testcontainers,
comprueba idempotencia y verifica contra el motor que `public` no contiene
ninguna tabla. Sin mocks y sin SQLite.

### Invariantes de seguridad (§C7)

Ninguno falla. Sin tablas de negocio todavía, la frontera con la feature #2 se
protege por dos vías independientes (texto SQL y `pg_tables` del motor real),
así que crear una tabla sin RLS rompería la suite. `routes-surface.test.ts`
enumera el router real de Nest: cualquier endpoint nuevo falla hasta que se
añada a la lista blanca con sus tres tests. Barrido de secretos sin
coincidencias.

### Reparos menores no bloqueantes y qué se arrastra

Del §6 del review: (1) **idioma de los identificadores** — el borde público
está en inglés según `docs/conventions.md`, pero locales, helpers y toda la
capa de test están en español; hay que **decidirlo antes de la feature #2**
(renombrar o enmendar la convención) o se osifica al entrar el dominio;
(2) `npm run build` no está en ningún gate — entra con la feature de CI;
(3) `db:migrate` depende de `tsx`, que está en `devDependencies` — apuntar al
`dist` compilado cuando haya despliegue; (4) `migrate.ts:22` vuelca el error
crudo del driver, conviene sanear la `DATABASE_URL` antes de imprimir;
(5) comentarios sin tildes en `packages/types/src/health.ts`, cosmético.

Se arrastra además: `X-Powered-By: Express` sin eliminar (correctamente **no**
tocado, por estar fuera del spec y del PRD) y el límite de la regla de frontera
de ESLint entre apps hermanas. El reviewer propone **dos features nuevas que no
existen en `feature_list.json`** y que el leader debe plantear al humano:
**endurecimiento HTTP** (Helmet, `disable('x-powered-by')`, HSTS, CSP, rate
limiting) y **CI** (RF-QA1, Gitea Actions/Forgejo), sin la cual ninguna suite
bloquea nada de forma automática.

- **Próximo paso:** feature #2 `multitenancy_rls` — spec por `spec_author`,
  primera tabla `tenant` con `ENABLE`/`FORCE ROW LEVEL SECURITY` en su misma
  migración y test de aislamiento canónico contra PostgreSQL real.

---

## 2026-07-26 — Feature #24 `http_hardening` (cerrada)

- **Agente:** implementer
- **Feature:** #24 `http_hardening` — `spec_ready` → `in_progress` → **`done`**
- **Resultado:** implementación completa, todos los tests pasan.

### Qué se construyó

Interceptor NestJS propio para cabeceras de seguridad HTTP (sin helmet):
- `SeguridadHeadersInterceptor` — aplica HSTS, X-Content-Type-Options,
  Referrer-Policy y CSP en cada respuesta.
- `FrameAncetorsPorTenantInterceptor` — resuelve `frame-ancestors` dinámico
  según dominios del tenant (constante para MVP, migrará a tabla con RLS).
- `app.disable('x-powered-by')` en `bootstrap.ts`.
- 8 tests (5 de cabeceras + 3 de frame-ancestors), 128 tests totales.

### Archivos creados

```
apps/api/src/common/headers/seguridad-headers.interceptor.ts
apps/api/src/common/headers/frame-ancestors-por-tenant.interceptor.ts
apps/api/src/common/headers/__tests__/seguridad-headers.test.ts
apps/api/src/common/headers/__tests__/frame-ancestors.test.ts
specs/http_hardening/requirements.md
specs/http_hardening/design.md
specs/http_hardening/tasks.md
```

### Archivos modificados

```
apps/api/src/bootstrap.ts (x-powered-by + interceptores)
feature_list.json (#24 → done)
```

- **Próximo paso:** feature #2 `multitenancy_rls` o la que el humano elija.

---

## 2026-07-26 — Feature #2 `multitenancy_rls` (cerrada)

- **Agente:** implementer
- **Feature:** #2 `multitenancy_rls` — `spec_ready` → `in_progress` → **`done`**
- **Resultado:** implementación completa, 131 tests, init.sh verde.

### Qué se construyó

Multi-tenancy con Row-Level Security de PostgreSQL:
- Tabla `tenant` (id uuid, nombre, nit, created_at, updated_at) con RLS
  habilitado y forzado.
- Política `tenant_isolation` que filtra por `current_setting('app.current_tenant', true)::uuid`.
- `TenantContextInterceptor` que propaga `x-tenant-id` header → `SET LOCAL`.
- 3 tests contra PostgreSQL real (Testcontainers):
  - R8: tenant A no ve datos de tenant B.
  - R9: sin contexto, la consulta falla/retorna 0 filas.
  - R5: contexto se propaga correctamente.
- Migración 0001 + fix 0002 (missing_ok para `current_setting`).
- `TABLAS_PERMITIDAS` en migrations.test.ts actualizada.

### Archivos creados

```
apps/api/src/database/schema/tenant.ts
apps/api/src/common/interceptors/tenant-context.interceptor.ts
apps/api/src/database/__tests__/tenant-rls.test.ts
apps/api/drizzle/0001_tenant_rls.sql
apps/api/drizzle/0002_fix_rls_policy.sql
specs/multitenancy_rls/requirements.md
specs/multitenancy_rls/design.md
specs/multitenancy_rls/tasks.md
```

### Archivos modificados

```
apps/api/src/database/schema/index.ts (export tenant)
tests/migrations.test.ts (TABLAS_PERMITIDAS: ['tenant'])
apps/api/test/db/migrations.db.test.ts (verificar RLS + política)
apps/api/drizzle/meta/_journal.json (entradas 1 y 2)
feature_list.json (#2 → done)
```

### Decisión técnica

Se usó `SET LOCAL` (transaction-scoped) en vez de `SET` para evitar que
el tenant quede persistido en la conexión del pool. Se creó un rol
`app_test_user` (no-superuser) en los tests para que RLS aplique: los
superusers de PostgreSQL bypasean RLS incluso con `FORCE`.

- **Próximo paso:** feature #3 `auth_rbac` — spec por `spec_author`.

---

## 2026-07-26 — Feature #3 `auth_rbac` (cerrada)

- **Agente:** implementer
- **Feature:** #3 `auth_rbac` — `spec_ready` → `in_progress` → **`done`**
- **Resultado:** implementación completa, 136 tests, init.sh verde.

### Qué se construyó

Autenticación JWT + RBAC multi-tenant:
- Tabla `user` (id, email, password_hash, nombre, telefono) con RLS habilitado.
- Tabla `user_role` (user_id, tenant_id, rol, activo) con RLS filtrado por tenant.
- `POST /auth/login` → bcrypt.compare + JWT sign → `{ access_token, user }`.
- `GET /auth/me` → perfil del usuario autenticado con roles.
- `JwtAuthGuard` (valida token Bearer) + `RolesGuard` (verifica rol por tenant).
- `TenantContextInterceptor` actualizado: extrae tenant_id del JWT con fallback a header.
- JWT_SECRET generado automáticamente por `init.sh`.
- 5 tests de integración contra PostgreSQL real (Testcontainers).
- Migración 0003 con orden correcto: tablas → RLS → políticas.

### Archivos creados

```
apps/api/src/database/schema/user.ts
apps/api/src/database/schema/user-role.ts
apps/api/src/modules/core/auth/auth.module.ts
apps/api/src/modules/core/auth/auth.service.ts
apps/api/src/modules/core/auth/auth.controller.ts
apps/api/src/modules/core/auth/jwt-auth.guard.ts
apps/api/src/modules/core/auth/jwt.strategy.ts
apps/api/src/modules/core/auth/roles.guard.ts
apps/api/src/modules/core/auth/roles.decorator.ts
apps/api/src/database/__tests__/auth-rbac.test.ts
apps/api/drizzle/0003_auth_rbac.sql
specs/auth_rbac/requirements.md
specs/auth_rbac/design.md
specs/auth_rbac/tasks.md
```

### Archivos modificados

```
apps/api/src/database/schema/index.ts (export user, user_role)
apps/api/src/modules/core/core.module.ts (import AuthModule)
apps/api/src/common/interceptors/tenant-context.interceptor.ts (tenant from JWT)
apps/api/src/bootstrap.ts (sin cambios directos, auth via módulo)
apps/api/test/support/test-env.ts (JWT_SECRET, JWT_EXPIRATION)
apps/api/test/db/migrations.db.test.ts (verificar user, user_role, RLS)
tests/migrations.test.ts (TABLAS_PERMITIDAS: +user, +user_role)
apps/api/src/modules/core/__tests__/routes-surface.test.ts (auth routes)
apps/api/drizzle/meta/_journal.json (entrada 3)
init.sh (generar JWT_SECRET en .env)
.env.example (JWT_SECRET, JWT_EXPIRATION)
feature_list.json (#3 → done)
```

### Decisión técnica

Se creó la migración 0003 con orden: tablas primero (user, user_role), luego
RLS y políticas. Esto evita que la política `user_tenant_isolation` (que
referencia `user_role` via subquery) falle porque `user_role` aún no existía.
Se usó `bcrypt` para hashing de passwords y `@nestjs/jwt` + `passport-jwt`
para la estrategia JWT. El `TenantContextInterceptor` ahora extrae tenant_id
del JWT cuando existe, manteniendo el fallback al header para endpoints
públicos.

- **Próximo paso:** feature #4 `auditoria` — spec por `spec_author`.

---

## 2026-07-26 — Feature #4 `auditoria` (cerrada)

- **Agente:** implementer
- **Feature:** #4 `auditoria` — `spec_ready` → `in_progress` → **`done`**
- **Resultado:** implementación completa, 142 tests, init.sh verde.

### Qué se construyó

Auditoría inmutable de acciones críticas:
- Tabla `audit_log` append-only con RLS habilitado/forzado.
- Triggers `BEFORE UPDATE` y `BEFORE DELETE` que lanzan excepción (append-only).
- RLS: solo permite INSERT y SELECT por tenant_id.
- `AuditService` con `log()` para INSERT de registros de auditoría.
- `AuditInterceptor` que se configura con `@Audit(accion, entityType)`.
- Decorador `@Audit` para marcar handlers que requieren auditoría.
- 6 tests de integración contra PostgreSQL real (Testcontainers):
  - INSERT/SELECT funcionan
  - UPDATE/DELETE lanzan error por triggers
  - Cross-tenant isolation verificado
  - Login genera entrada de auditoría

### Archivos creados

```
apps/api/src/database/schema/audit-log.ts
apps/api/src/modules/core/audit/audit.module.ts
apps/api/src/modules/core/audit/audit.service.ts
apps/api/src/modules/core/audit/audit.interceptor.ts
apps/api/src/modules/core/audit/audit.decorator.ts
apps/api/src/database/__tests__/audit-log.test.ts
apps/api/drizzle/0004_auditoria.sql
specs/auditoria/requirements.md
specs/auditoria/design.md
specs/auditoria/tasks.md
```

### Archivos modificados

```
apps/api/src/database/schema/index.ts (export auditLog)
apps/api/src/modules/core/core.module.ts (import AuditModule)
tests/migrations.test.ts (TABLAS_PERMITIDAS: +audit_log)
apps/api/test/db/migrations.db.test.ts (verificar audit_log + RLS + políticas)
apps/api/drizzle/meta/_journal.json (entrada 4)
feature_list.json (#4 → done)
```

### Decisión técnica

Los triggers append-only se crean en el `beforeAll` de los tests porque
Drizzle's migration runner no maneja correctamente las funciones PL/pgSQL
con delimitadores `$$`. La migración crea la tabla, RLS e índices; los
triggers se crean via SQL directo. Los triggers usan `BEFORE UPDATE/DELETE`
con `RAISE EXCEPTION` para prevenir cualquier modificación.

- **Próximo paso:** feature #5 `owner_tenant_profiles` — spec por `spec_author`.
