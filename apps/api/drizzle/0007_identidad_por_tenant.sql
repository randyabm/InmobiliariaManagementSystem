-- 0007_identidad_por_tenant — D-8 y D-12: `user` deja de ser global.
--
-- Feature #5 `owner_tenant_profiles`, hallazgo **B4** de
-- `progress/review_owner_tenant_profiles.md` y decisiones **D-8** y **D-12**
-- del humano. Cubre R33, R38, R49, R52, R59, R60, R61, R73, R75, R76, R77.
--
-- QUÉ ESTABA MAL (B4). `user_tenant_isolation` (`0003_auth_rbac.sql:48-54`) es
-- `FOR ALL` sin `WITH CHECK`, así que PostgreSQL reutiliza el `USING` como
-- `WITH CHECK`. Mientras la aplicación se conecta como superusuario da igual
-- —el RLS es inerte para él—, pero en cuanto deje de serlo (T61) crear una
-- identidad sería imposible: el `WITH CHECK` exige un `user_role` que todavía
-- no puede existir. El defecto de fondo no era la política sino que `user`
-- **no tenía `tenant_id`** y se le había puesto una política diseñada para
-- tablas que sí lo tienen.
--
-- D-8 lo elimina de raíz: las identidades nunca se comparten entre
-- inmobiliarias, así que `user` pasa a ser una tabla de negocio normal, con su
-- `tenant_id` y la política estándar del proyecto.
--
-- D-12 añade `tenant.codigo`, el identificador legible con el que el login
-- sabrá en qué inmobiliaria entra (el correo ya no identifica a nadie por sí
-- solo). Es una **etiqueta DNS válida** a propósito: el mismo valor servirá de
-- subdominio en RF-INT2/RF-INT3 sin migrar nada.
--
-- ORDEN DE ESTA MIGRACIÓN. Primero `tenant.codigo` (no depende de nada),
-- después `user.tenant_id` (que necesita `tenant` íntegra), y al final la
-- política y la función de resolución. Forward-only e idempotente
-- (`docs/conventions.md`): se puede reaplicar sin fallar y no hay `down`.
--
-- ESTA MIGRACIÓN NO ROMPE EL LOGIN. Cuando se aplica, la aplicación sigue
-- conectándose como superusuario, así que la política nueva es inerte y
-- `tenant_por_codigo` no la usa nadie todavía. El login pasa a exigir el
-- `codigo` en T57 y el conmutador de rol es T61 (`design.md` §16 y §20.5).

-- ───────────────────────────────────────────────────────────────────────────
-- 1) D-12: `tenant.codigo` (R73, R75, R76, R77)
-- ───────────────────────────────────────────────────────────────────────────

-- Derivación determinista del código a partir del nombre (R76). Es una función
-- y no un bloque suelto porque la usan tres sitios: el backfill de aquí abajo,
-- los tests de R76 y quien dé de alta una inmobiliaria a mano (R77, PA-14),
-- que hoy es una operación directa sobre la base.
--
-- Determinista quiere decir literalmente eso: el mismo `nombre` produce el
-- mismo `codigo` en desarrollo, en CI y en producción, así que ningún test
-- depende del orden de inserción.
CREATE OR REPLACE FUNCTION tenant_codigo_desde_nombre(p_nombre text)
RETURNS text AS $fn$
DECLARE
  v text;
BEGIN
  v := lower(coalesce(p_nombre, ''));

  -- Sin tildes ni `ñ` (`docs/conventions.md` y R73): se translitera en vez de
  -- borrarse, para que "Sión" no acabe siendo "sin".
  v := translate(v,
         'áàäâãéèëêíìïîóòöôõúùüûñç',
         'aaaaaeeeeiiiiooooouuuunc');

  -- Todo lo que no sea [a-z0-9] es separador; los separadores seguidos
  -- colapsan en un solo guion.
  v := regexp_replace(v, '[^a-z0-9]+', '-', 'g');
  v := trim(both '-' from v);
  v := left(v, 63);
  v := trim(both '-' from v);   -- el recorte pudo dejar un guion final

  -- Fallback para un nombre que no deja nada utilizable (vacío, solo signos, o
  -- menos de los 3 caracteres que exige R73). No es una decisión de producto:
  -- es que la columna es NOT NULL y hay que poner *algo* determinista. Quien
  -- dé de alta la inmobiliaria escribirá el código de verdad (R77).
  IF length(v) < 3 THEN
    v := 'inmobiliaria';
  END IF;

  RETURN v;
END;
$fn$ LANGUAGE plpgsql IMMUTABLE;
--> statement-breakpoint

COMMENT ON FUNCTION tenant_codigo_desde_nombre(text) IS
  'Deriva un codigo de inmobiliaria (etiqueta DNS valida) desde el nombre, de forma determinista (R76). No resuelve colisiones: eso lo hace quien inserta.';
--> statement-breakpoint

ALTER TABLE "tenant" ADD COLUMN IF NOT EXISTS "codigo" text;
--> statement-breakpoint

-- Backfill con resolución de colisiones por el sufijo numérico MÁS BAJO
-- disponible (R76). Se recorre en orden de `created_at, id` para que el
-- resultado sea el mismo en cualquier entorno: el primero se queda el código
-- limpio y los siguientes reciben `-2`, `-3`, …
--
-- Los nombres reservados (R75) entran por el mismo camino: si el nombre de una
-- inmobiliaria deriva en `api`, se le asigna `api-2`. Reservarlos ahora cuesta
-- una lista; hacerlo cuando el subdominio ya esté desplegado cuesta renombrar
-- a un cliente en producción.
DO $$
DECLARE
  fila     record;
  base     text;
  candidato text;
  sufijo   integer;
BEGIN
  FOR fila IN
    SELECT id, nombre FROM "tenant" WHERE "codigo" IS NULL ORDER BY created_at, id
  LOOP
    base := tenant_codigo_desde_nombre(fila.nombre);
    candidato := base;
    sufijo := 1;

    WHILE candidato IN ('www', 'api', 'app', 'admin', 'portal', 'static', 'mail', 'cdn')
       OR EXISTS (SELECT 1 FROM "tenant" WHERE "codigo" = candidato)
    LOOP
      sufijo := sufijo + 1;
      candidato := left(base, 63 - length(sufijo::text) - 1) || '-' || sufijo::text;
    END LOOP;

    UPDATE "tenant" SET "codigo" = candidato WHERE id = fila.id;
  END LOOP;
END $$;
--> statement-breakpoint

-- El CHECK es la barrera real de R73 y R75: valida el código **venga de donde
-- venga**, también cuando el alta es un INSERT a mano (R77). No hay endpoint
-- de alta de inmobiliaria todavía —el PRD describe el Super Admin pero no un
-- `RF-*` de onboarding, ver PA-14—, así que el motor es el único sitio donde
-- esta regla se puede imponer hoy.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenant_codigo_formato_check'
  ) THEN
    ALTER TABLE "tenant" ADD CONSTRAINT "tenant_codigo_formato_check" CHECK (
      "codigo" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
      AND length("codigo") BETWEEN 3 AND 63
      AND "codigo" NOT IN ('www', 'api', 'app', 'admin', 'portal', 'static', 'mail', 'cdn')
    );
  END IF;
END $$;
--> statement-breakpoint

ALTER TABLE "tenant" ALTER COLUMN "codigo" SET NOT NULL;
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenant_codigo_key'
  ) THEN
    ALTER TABLE "tenant" ADD CONSTRAINT "tenant_codigo_key" UNIQUE ("codigo");
  END IF;
END $$;
--> statement-breakpoint

-- ───────────────────────────────────────────────────────────────────────────
-- 2) D-8: `user.tenant_id` (R59, R61)
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;
--> statement-breakpoint

-- R61: la migración NO adivina el tenant. Si alguna identidad tiene roles en
-- más de una inmobiliaria, aborta con un mensaje accionable: repartir personas
-- entre inmobiliarias sin traza es peor que parar. Lo mismo si alguna identidad
-- no tiene ningún rol, porque entonces no hay de dónde deducirlo.
DO $$
DECLARE
  ambiguas integer;
  huerfanas integer;
BEGIN
  SELECT count(*) INTO ambiguas FROM (
    SELECT ur.user_id FROM user_role ur
     GROUP BY ur.user_id HAVING count(DISTINCT ur.tenant_id) > 1
  ) q;

  IF ambiguas > 0 THEN
    RAISE EXCEPTION
      'D-8: % identidades tienen roles en mas de una inmobiliaria y esta migracion no elige por ti. Duplica cada identidad, una por tenant, y reasigna sus user_role antes de reintentar.',
      ambiguas;
  END IF;

  SELECT count(*) INTO huerfanas
    FROM "user" u
   WHERE u."tenant_id" IS NULL
     AND NOT EXISTS (SELECT 1 FROM user_role ur WHERE ur.user_id = u.id);

  IF huerfanas > 0 THEN
    RAISE EXCEPTION
      'D-8: % identidades no tienen ningun user_role, asi que no hay de donde deducir su inmobiliaria. Asignales un rol o eliminalas antes de reintentar.',
      huerfanas;
  END IF;
END $$;
--> statement-breakpoint

-- `ORDER BY … LIMIT 1` y no `min(...)`: PostgreSQL 16 no tiene agregado `min`
-- para `uuid`. Da igual cuál se tome: el bloque de arriba ya garantizó que
-- cada identidad tiene roles en una sola inmobiliaria.
UPDATE "user" u
   SET "tenant_id" = (
     SELECT ur.tenant_id FROM user_role ur
      WHERE ur.user_id = u.id ORDER BY ur.tenant_id LIMIT 1
   )
 WHERE u."tenant_id" IS NULL;
--> statement-breakpoint

ALTER TABLE "user" ALTER COLUMN "tenant_id" SET NOT NULL;
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_tenant_id_fkey'
  ) THEN
    ALTER TABLE "user"
      ADD CONSTRAINT "user_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id");
  END IF;
END $$;
--> statement-breakpoint

-- ───────────────────────────────────────────────────────────────────────────
-- 3) D-8: la unicidad del correo pasa de global a por inmobiliaria (R59)
-- ───────────────────────────────────────────────────────────────────────────
--
-- Dos personas distintas con el mismo correo, cada una en su inmobiliaria, son
-- ahora dos identidades legítimas: es la consecuencia directa de D-8, y la que
-- obliga al login a pedir el `codigo` (R63). Los NULL siguen conviviendo sin
-- índice parcial, porque PostgreSQL trata cada NULL como distinto (D-5, R7).

ALTER TABLE "user" DROP CONSTRAINT IF EXISTS "user_email_key";
--> statement-breakpoint
ALTER TABLE "user" DROP CONSTRAINT IF EXISTS "user_email_unique";
--> statement-breakpoint
DROP INDEX IF EXISTS "user_email_key";
--> statement-breakpoint
DROP INDEX IF EXISTS "user_email_unique";
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_tenant_email_key'
  ) THEN
    ALTER TABLE "user"
      ADD CONSTRAINT "user_tenant_email_key" UNIQUE ("tenant_id", "email");
  END IF;
END $$;
--> statement-breakpoint

-- ───────────────────────────────────────────────────────────────────────────
-- 4) D-8: un rol no puede apuntar a otro tenant que el de su identidad (R60)
-- ───────────────────────────────────────────────────────────────────────────
--
-- Sin esto, el modelo se degradaría en silencio con el tiempo: bastaría un
-- `INSERT` de `user_role` con el tenant equivocado para reintroducir la
-- identidad compartida por la puerta de atrás. La FK compuesta lo hace
-- imposible en el motor, no en la revisión de código.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_id_tenant_key'
  ) THEN
    ALTER TABLE "user" ADD CONSTRAINT "user_id_tenant_key" UNIQUE ("id", "tenant_id");
  END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_role_user_tenant_fkey'
  ) THEN
    ALTER TABLE "user_role"
      ADD CONSTRAINT "user_role_user_tenant_fkey"
      FOREIGN KEY ("user_id", "tenant_id") REFERENCES "user"("id", "tenant_id");
  END IF;
END $$;
--> statement-breakpoint

-- ───────────────────────────────────────────────────────────────────────────
-- 5) D-8: política estándar del proyecto sobre `user` (R49)
-- ───────────────────────────────────────────────────────────────────────────
--
-- Sustituye la `FOR ALL` sin `WITH CHECK` de `0003_auth_rbac.sql`. Ahora `user`
-- lleva exactamente la misma política que `perfil_propietario`,
-- `perfil_inquilino` y `cuenta_bancaria`, con el predicado escrito **también**
-- en `WITH CHECK`: leer filas de otra inmobiliaria y escribirlas son dos
-- permisos distintos y los dos quedan negados de forma explícita, sin depender
-- de que PostgreSQL reutilice el `USING`.
--
-- `DELETE` no se menciona porque no se concede: la identidad no se borra
-- (`docs/conventions.md`) y el rol de aplicación no tendrá ese privilegio
-- (R45, T60).

DROP POLICY IF EXISTS "user_tenant_isolation" ON "user";
--> statement-breakpoint

CREATE POLICY "user_tenant_isolation" ON "user"
  USING ("tenant_id" = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.current_tenant', true)::uuid);
--> statement-breakpoint

ALTER TABLE "user" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- ───────────────────────────────────────────────────────────────────────────
-- 6) D-8 + D-12: la ÚNICA ruta de lectura previa al contexto de tenant (R52)
-- ───────────────────────────────────────────────────────────────────────────
--
-- El login es previo al tenant por naturaleza: hay que resolver `codigo` →
-- `tenant_id` antes de poder fijar `app.current_tenant`. Esa es toda la
-- superficie que se concede, y es mínima a propósito:
--
--   * coincidencia EXACTA, sin patrones ni `LIKE`;
--   * devuelve un `uuid`, nunca un listado ni un nombre;
--   * el parámetro es un código que la propia inmobiliaria reparte a sus
--     usuarios, no un dato que haya que proteger.
--
-- Antes de D-8 hacían falta dos funciones `SECURITY DEFINER` **sobre `user`**
-- (una para el login y otra para vincular por correo entre tenants). Con D-8
-- solo queda esta, y no toca `user`.
--
-- `REVOKE ALL FROM PUBLIC` aquí; el `GRANT EXECUTE` al rol de aplicación lo da
-- el procedimiento de provisión (R46, T60), que corre DESPUÉS de las
-- migraciones porque ese rol todavía no existe cuando esta se aplica.

CREATE OR REPLACE FUNCTION tenant_por_codigo(p_codigo text)
RETURNS uuid AS $fn$
  SELECT t.id FROM "tenant" t WHERE t."codigo" = p_codigo;
$fn$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp;
--> statement-breakpoint

COMMENT ON FUNCTION tenant_por_codigo(text) IS
  'R52: unica ruta de lectura que evita el RLS. Coincidencia exacta por tenant.codigo, devuelve solo el uuid. La usa POST /auth/login antes de fijar app.current_tenant. No exponer ninguna otra.';
--> statement-breakpoint

REVOKE ALL ON FUNCTION tenant_por_codigo(text) FROM PUBLIC;
--> statement-breakpoint

REVOKE ALL ON FUNCTION tenant_codigo_desde_nombre(text) FROM PUBLIC;
