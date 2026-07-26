-- 0000_init — esquema base del sistema.
--
-- DELIBERADAMENTE NO CREA NINGUNA TABLA DE NEGOCIO (R11).
--
-- docs/conventions.md exige que toda tabla de negocio habilite RLS en la MISMA
-- migración que la crea. La forma de no violar esa regla en un andamiaje es no
-- crear tablas todavía: la primera (`tenant`), junto con
-- `ENABLE`/`FORCE ROW LEVEL SECURITY` y sus políticas, pertenece a la feature
-- #2 `multitenancy_rls`. El test `migrations.test.ts` falla si alguien se
-- adelanta y añade un `CREATE TABLE` aquí.
--
-- Forward-only e idempotente: no hay archivo `down`.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS "citext";
