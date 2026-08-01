-- 0009_identidad_por_documento — #26: la identidad de un cliente se reconoce
-- por su DOCUMENTO dentro de la inmobiliaria. Cubre R5 y R6.
--
-- POR QUÉ EXISTE. D-9 (feature #5) mudó el contacto al perfil, y con ello
-- `user.email` quedó NULL para todo cliente registrado por la inmobiliaria.
-- Desapareció así la clave por la que reconocer a la misma persona **dentro**
-- de una agencia: hoy, quien es propietario **e** inquilino de la misma
-- inmobiliaria son dos filas de `user`, con dos credenciales potenciales. El
-- documento pasa a ser esa clave.
--
-- QUÉ NO HACE:
--
--   * **No crea ninguna tabla**, luego no hay política de RLS nueva que
--     escribir. `user` ya tiene `user_tenant_isolation` (USING + WITH CHECK)
--     con `FORCE ROW LEVEL SECURITY` desde `0007:289-297`, y una política de
--     PostgreSQL se evalúa **por fila, no por columna**: cubre automáticamente
--     las dos columnas que se añaden aquí. Eso no se asume, se verifica en
--     `apps/api/test/db/migrations.db.test.ts` (T6) y con el rol de aplicación
--     real en `identidad-por-documento-rls` (T7).
--   * **No busca ni vincula nada fuera del tenant.** D-8 sigue vigente: la
--     unicidad es `(tenant_id, tipo_documento, documento)`, nunca global.
--   * **No fusiona identidades ya duplicadas.** Ver el bloque 4.
--
-- Forward-only e idempotente (`docs/conventions.md`).

-- ───────────────────────────────────────────────────────────────────────────
-- 1) Las columnas (R5)
-- ───────────────────────────────────────────────────────────────────────────
--
-- NULL-ables **a propósito**: los empleados y administradores se dan de alta
-- sin documento (feature #3) y obligarlos a tener uno produciría datos falsos,
-- que es el mismo motivo por el que D-5 hizo `email` NULL-able.

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "tipo_documento" text;
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "documento" text;
--> statement-breakpoint

-- ───────────────────────────────────────────────────────────────────────────
-- 2) Dominio y coherencia
-- ───────────────────────────────────────────────────────────────────────────
--
-- El mismo dominio que ya usan los perfiles (`0005:43-44`): si divergieran, el
-- backfill del bloque 3 podría copiar un valor que la identidad no admite.
-- El segundo CHECK impide el estado a medias (tipo sin número o al revés), que
-- haría del índice único del bloque 5 una promesa vacía.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_tipo_documento_check'
  ) THEN
    ALTER TABLE "user" ADD CONSTRAINT "user_tipo_documento_check"
      CHECK ("tipo_documento" IN ('CC', 'CE', 'NIT', 'PASAPORTE'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_documento_coherente_check'
  ) THEN
    ALTER TABLE "user" ADD CONSTRAINT "user_documento_coherente_check"
      CHECK (("tipo_documento" IS NULL) = ("documento" IS NULL));
  END IF;
END $$;
--> statement-breakpoint

-- ───────────────────────────────────────────────────────────────────────────
-- 3) Backfill desde los perfiles existentes
-- ───────────────────────────────────────────────────────────────────────────
--
-- Primero `perfil_propietario` y después `perfil_inquilino` **solo** para las
-- identidades que sigan sin documento. El orden es arbitrario en el caso sano
-- (una identidad con los dos perfiles tiene el mismo documento en ambos, o no
-- sería la misma persona) y determinista en el caso roto, que es lo que
-- importa para poder escribir un test.
--
-- Solo se rellena lo que está vacío: reaplicar la migración no pisa un
-- documento ya escrito.

UPDATE "user" u
   SET "tipo_documento" = p."tipo_documento",
       "documento"      = p."documento"
  FROM "perfil_propietario" p
 WHERE p."user_id" = u."id"
   AND p."tenant_id" = u."tenant_id"
   AND u."documento" IS NULL;
--> statement-breakpoint

UPDATE "user" u
   SET "tipo_documento" = p."tipo_documento",
       "documento"      = p."documento"
  FROM "perfil_inquilino" p
 WHERE p."user_id" = u."id"
   AND p."tenant_id" = u."tenant_id"
   AND u."documento" IS NULL;
--> statement-breakpoint

-- ───────────────────────────────────────────────────────────────────────────
-- 4) Identidades ya duplicadas: se avisan, NO se fusionan (PA-2)
-- ───────────────────────────────────────────────────────────────────────────
--
-- DECISIÓN DEL HUMANO (2026-08-01). Una base de desarrollo puede tener hoy dos
-- filas de `user` para la misma persona —propietario + inquilino—, que es justo
-- el defecto que esta feature cierra. Fusionarlas es una decisión de producto
-- (qué credencial sobrevive, qué pasa con la auditoría ya escrita a nombre de
-- la identidad que desaparece, y con los contratos que la referencian) y no la
-- toma una migración. No hay datos reales todavía: se avisa con el conteo, el
-- invariante R6 rige hacia adelante y los datos de prueba se recrean.
--
-- **Esta decisión caduca al llegar a producción.** Entonces hará falta una
-- herramienta de fusión con criterio, y eso es feature propia.
--
-- Tampoco se aborta (a diferencia de R61 de la #5): aquí la colisión no impide
-- que el sistema quede correcto hacia adelante, y abortar dejaría a cualquiera
-- con datos de prueba con la base bloqueada y sin salida.
--
-- Se deja en NULL la fila colisionante **más reciente** (`created_at`, con `id`
-- como desempate) para que el índice parcial se pueda crear: la identidad más
-- antigua es la que conserva el documento.

DO $$
DECLARE
  colisiones integer;
BEGIN
  WITH ordenadas AS (
    SELECT "id",
           row_number() OVER (
             PARTITION BY "tenant_id", "tipo_documento", "documento"
             ORDER BY "created_at", "id"
           ) AS posicion
      FROM "user"
     WHERE "documento" IS NOT NULL
  ),
  limpiadas AS (
    UPDATE "user"
       SET "tipo_documento" = NULL, "documento" = NULL
     WHERE "id" IN (SELECT "id" FROM ordenadas WHERE posicion > 1)
    RETURNING 1
  )
  SELECT count(*) INTO colisiones FROM limpiadas;

  IF colisiones > 0 THEN
    RAISE WARNING
      '#26: % identidades duplicadas por (tenant_id, tipo_documento, documento) se quedaron SIN documento para poder crear el indice unico. NO se han fusionado (decision del humano, PA-2): el invariante rige hacia adelante y esos datos de prueba deben recrearse. Consulta de diagnostico en progress/impl_identidad_multirol_cliente.md.',
      colisiones;
  END IF;
END $$;
--> statement-breakpoint

-- ───────────────────────────────────────────────────────────────────────────
-- 5) El invariante, en el motor (R6)
-- ───────────────────────────────────────────────────────────────────────────
--
-- Índice único **parcial**: sin el `WHERE documento IS NOT NULL` no haría
-- falta —los NULL no colisionan entre sí en un índice único de PostgreSQL—,
-- pero se escribe explícito porque es la intención (empleados y
-- administradores sin documento no deben estorbarse) y porque hace el índice
-- más pequeño.
--
-- Es este índice, y no el servicio, quien garantiza R6: es lo que se puede
-- poner en rojo con una mutación (T27a).
--
-- Sirve además como índice de búsqueda de `buscarPorDocumentoEnEsteTenant`:
-- su prefijo `(tenant_id, tipo_documento, documento)` es exactamente el
-- predicado de la consulta. No se añade ningún índice más.

CREATE UNIQUE INDEX IF NOT EXISTS "user_tenant_documento_key"
  ON "user" ("tenant_id", "tipo_documento", "documento")
  WHERE "documento" IS NOT NULL;
--> statement-breakpoint

COMMENT ON COLUMN "user"."documento" IS
  'R5/#26: documento de la persona, clave por la que se deduplica la identidad DENTRO de la inmobiliaria. NULL en empleados y administradores. Unico por (tenant_id, tipo_documento, documento), nunca global: D-8 prohibe reconocer a la misma persona entre inmobiliarias.';
