# Tasks — `project_scaffold` (feature #1, fase 1a)

> Orden de ejecución. El `implementer` marca `[x]` al completar cada una.
> Las tasks de test son **de primera clase**: no se dejan para el final.
> Prerrequisito: el humano aprobó las decisiones abiertas de
> `design.md` §11 (ORM, gestor de paquetes, bundler, scope npm).

## Bloque A — Base del monorepo

- [x] T1 — Crear `package.json` raíz con `workspaces: ["apps/*", "packages/*"]`, `engines.node >= 20`, `private: true` y `.nvmrc`. Cubre: R1.
- [x] T2 — Crear `tsconfig.base.json` con `strict: true` y `paths` hacia `@inmobiliaria/types`; un `tsconfig.json` por workspace que lo extienda. Cubre: R4, R5.
- [x] T3 — Crear `packages/types` (`@inmobiliaria/types`) con `src/index.ts` exportando al menos un tipo compartido real (p. ej. `HealthStatus`). Cubre: R1, R4.
- [x] T4 — Configurar ESLint 9 (flat config) + Prettier en la raíz, incluyendo la regla que prohíbe imports relativos entre paquetes. Cubre: R4, R7.
- [x] T5 — Definir los scripts raíz `lint`, `format:check`, `typecheck`, `test`, `test:db`, `build`, `dev`, `db:migrate`, `db:generate` según `design.md` §6. Cubre: R6, R10, R19.
- [x] T6 — **Test** estructural del monorepo: workspaces declarados y resueltos, y `strict === true` en todos los `tsconfig`. Cubre: R1, R5.
- [x] T7 — **Test** de lint efectivo: ejecutar ESLint programáticamente sobre código que viola una regla activa y esperar error de severidad 2. Cubre: R7.

## Bloque B — Aplicación API (NestJS)

- [x] T8 — Andamiar `apps/api` (NestJS + TypeScript) con `src/main.ts`, `src/app.module.ts` y `src/modules/core/core.module.ts`. Cubre: R2.
- [x] T9 — Configurar Vitest en `apps/api` con `unplugin-swc` (decoradores + metadata) y Supertest. Cubre: R6.
- [x] T10 — Implementar `src/config/` con validación de entorno vía Zod (`NODE_ENV`, `PORT`, `DATABASE_URL`, `CORS_ORIGINS` requeridas; Redis/MinIO opcionales) y `ConfigurationError`. Cubre: R17.
- [x] T11 — Implementar `src/common/errors/` (`AppError`, `ConfigurationError`, `ResourceNotFoundError`) y el filtro global de excepciones: mensajes en español, sin stack traces ni SQL. Cubre: R16.
- [x] T12 — Configurar CORS con lista explícita desde `CORS_ORIGINS`; prohibido `*` y `origin: true`. Cubre: R18.
- [x] T13 — Implementar `modules/core/health` (`HealthService.getStatus()` + `HealthController` `GET /health`) devolviendo exactamente `{ status, version, uptime }` y sin tocar PostgreSQL/Redis/MinIO. Cubre: R13, R14, R15.
- [x] T14 — **Test de humo**: arrancar la app NestJS real y verificar `GET /health` → 200 con `status: "ok"` y `version`, en un entorno sin infraestructura levantada. Cubre: R13, R14.
- [x] T15 — **Test de seguridad** de la respuesta de `/health`: lista blanca exacta de claves; falla ante cualquier campo extra (env, conexión, tenant). Cubre: R15.
- [x] T16 — **Test de superficie**: enumerar las rutas registradas en el router y compararlas con la lista blanca `GET /health`; ruta inexistente → 404 en español y sin `stack` en el cuerpo. Cubre: R16.
- [x] T17 — **Test de configuración**: arrancar la validación sin una variable requerida y esperar `ConfigurationError` con el nombre de la variable. Cubre: R17.
- [x] T18 — **Test de CORS**: la configuración aplicada nunca resuelve a `*` ni a "cualquier origen". Cubre: R18.

## Bloque C — Aplicación Web (React)

- [x] T19 — Andamiar `apps/web` (React + TypeScript + Vite) con el shell mínimo y estados de carga/error explícitos donde consulte la API. Cubre: R3.
- [x] T20 — Configurar Vitest + Testing Library en `apps/web` e importar un tipo desde `@inmobiliaria/types` para probar el alias del workspace. Cubre: R3, R4.
- [x] T21 — **Test** de componente que renderiza el shell de `apps/web`. Cubre: R3.

## Bloque D — Infraestructura local declarada (sin levantar contenedores)

- [x] T22 — Crear `docker-compose.yml` con PostgreSQL 16, Redis 7 y MinIO, con tags fijados (nunca `latest`), volúmenes nombrados y healthchecks. Cubre: R8.
- [x] T23 — Mover toda credencial del compose a variables de entorno y crear `.env.example` con placeholders (sin valores reales). Cubre: R9.
- [x] T24 — **Test** que parsea `docker-compose.yml`: los 3 servicios existen, ninguna imagen usa `latest`, y las credenciales son interpolaciones `${VAR}` presentes en `.env.example`. Cubre: R8, R9.

## Bloque E — Migraciones versionadas

- [x] T25 — Añadir Drizzle (`drizzle-orm`, `drizzle-kit`, `pg`), `drizzle.config.ts` y el cliente de base de datos en `src/database/`, sin abrir conexión durante el arranque de los tests. Cubre: R10, R14.
- [x] T26 — Crear la migración inicial `drizzle/0000_init.sql` (solo extensiones; **ninguna tabla de negocio**) y su entrada en `meta/_journal.json`. Cubre: R10, R11.
- [x] T27 — Implementar el runner `db:migrate` que lee `DATABASE_URL` y aborta con `ConfigurationError` si falta, en vez de fallar con un error crudo del driver. Cubre: R10, R17.
- [x] T28 — **Test** que lee `0000_init.sql` y falla si contiene `CREATE TABLE` fuera de la lista permitida (frontera con la feature #2, que es la que habilita RLS). Cubre: R11.
- [x] T29 — **Test** de consistencia del journal: entradas ordenadas, sin huecos ni duplicados, y correspondencia 1:1 con los archivos `.sql`. Cubre: R12.

## Bloque F — Separación de suites y cierre

- [x] T30 — Crear `vitest.db.config.ts` y el script `test:db` con Testcontainers, incluyendo la guarda que **falla con mensaje explícito** si Docker no está disponible. Cubre: R19.
- [x] T31 — Escribir el test de aplicación real de la migración inicial dentro de la suite `test:db`, documentando que su ejecución obligatoria pertenece a la feature #2 (`multitenancy_rls`). Cubre: R10, R19.
- [x] T32 — Verificar que `npm run test` no intenta abrir contenedores y termina en 0 en una máquina sin Docker. Cubre: R6, R19.
- [x] T33 — Actualizar `.gitignore` (node_modules, dist, `.env`, artefactos de test) y confirmar que no hay secretos versionados. Cubre: R9.
- [x] T34 — Ejecutar `./init.sh` y comprobar que las secciones 4 y 5 quedan verdes con los scripts reales ya definidos. Cubre: R6, R7, R9.
- [x] T35 — Escribir `progress/impl_project_scaffold.md` con el mapa de trazabilidad `R<n>` → nombre del test (`docs/verification.md` Nivel 5). Cubre: R1–R19.

---

## Notas para el reviewer

- **T31 ya no es deuda.** `design.md` §10 difería a la feature #2 la
  aplicación real de la migración por ausencia de Docker. Docker se instaló
  antes de esta sesión, así que la deuda frente a `CHECKPOINTS.md` §C4 se
  **cierra aquí**: `npm run test:db` levanta PostgreSQL 16 con Testcontainers,
  aplica `0000_init.sql` y verifica extensiones, idempotencia y ausencia de
  tablas de negocio. Salida real en `progress/impl_project_scaffold.md` §3.
- Ningún requirement de esta feature se declara cumplido por inspección
  visual: todos tienen un test o un paso de `./init.sh` asociado
  (`design.md` §13).
