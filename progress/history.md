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
