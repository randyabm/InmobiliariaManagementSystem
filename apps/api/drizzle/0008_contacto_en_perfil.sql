-- 0008_contacto_en_perfil — D-9: el contacto vive en el perfil, no en la
-- identidad. Cubre R68, R69, R70, R71.
--
-- DECISIÓN DEL HUMANO (D-9). `user` conserva solo la **credencial de acceso**;
-- el correo y el teléfono **de contacto** pasan a ser del perfil. El motivo que
-- dio: son un dato *de la relación comercial* con esa inmobiliaria, no de la
-- persona en abstracto. Dos inmobiliarias pueden tener datos de contacto
-- distintos del mismo propietario —uno le da su correo personal a una y el de
-- su empresa a otra— y ninguna debe pisar los de la otra. Con el contacto en
-- `user` eso era, sencillamente, imposible de representar.
--
-- Es un DELTA sobre el esquema que dejó `0005`, no un rediseño: tres columnas.
--
--   perfil_propietario  +email_contacto NULL, +telefono_contacto NULL   (D-5: el
--                        propietario puede no tener correo, R68)
--   perfil_inquilino    +email_contacto NOT NULL                        (RF-C4 lo
--                        exige; `celular` ya estaba y hace de teléfono, R69)
--   user                 (nada: conserva email/password_hash como credencial)
--
-- ORDEN, Y POR QUÉ IMPORTA (R70). Las columnas se añaden NULL-ables, **después**
-- se copian los datos que hoy viven en `user`, y **solo entonces** se impone el
-- `NOT NULL` de `perfil_inquilino.email_contacto`. Al revés, la migración
-- fallaría en cualquier base con inquilinos ya registrados, o —peor— habría que
-- inventarles un correo.
--
-- `user.telefono` NO se elimina: lo siguen usando los usuarios internos que crea
-- la feature #3. Simplemente deja de ser el teléfono de contacto de un cliente.
-- Borrarlo sería un cambio destructivo sin necesidad.
--
-- Forward-only e idempotente (`docs/conventions.md`).

-- ───────────────────────────────────────────────────────────────────────────
-- 1) Columnas nuevas, todas NULL-ables de momento (R68, R69)
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE "perfil_propietario" ADD COLUMN IF NOT EXISTS "email_contacto" text;
--> statement-breakpoint
ALTER TABLE "perfil_propietario" ADD COLUMN IF NOT EXISTS "telefono_contacto" text;
--> statement-breakpoint
ALTER TABLE "perfil_inquilino" ADD COLUMN IF NOT EXISTS "email_contacto" text;
--> statement-breakpoint

-- ───────────────────────────────────────────────────────────────────────────
-- 2) Traslado del dato que ya existe (R70)
-- ───────────────────────────────────────────────────────────────────────────
--
-- Solo se rellena lo que está vacío, para que reaplicar la migración no pise un
-- contacto que alguien haya editado ya en el perfil.

UPDATE "perfil_propietario" p
   SET "email_contacto"    = COALESCE(p."email_contacto", u."email"),
       "telefono_contacto" = COALESCE(p."telefono_contacto", u."telefono")
  FROM "user" u
 WHERE u."id" = p."user_id"
   AND (p."email_contacto" IS NULL OR p."telefono_contacto" IS NULL);
--> statement-breakpoint

UPDATE "perfil_inquilino" p
   SET "email_contacto" = u."email"
  FROM "user" u
 WHERE u."id" = p."user_id"
   AND p."email_contacto" IS NULL;
--> statement-breakpoint

-- ───────────────────────────────────────────────────────────────────────────
-- 3) Y SOLO AHORA, la obligatoriedad de RF-C4 (R69, R70)
-- ───────────────────────────────────────────────────────────────────────────
--
-- Si quedara algún inquilino sin correo, el `SET NOT NULL` fallaría con un
-- mensaje del motor que no dice qué hacer. Se comprueba antes para poder
-- explicarlo: R19 ya exigía el correo del inquilino, así que encontrarlo vacío
-- significaría que hay datos anteriores a esa regla.

DO $$
DECLARE
  sin_correo integer;
BEGIN
  SELECT count(*) INTO sin_correo
    FROM "perfil_inquilino" WHERE "email_contacto" IS NULL;

  IF sin_correo > 0 THEN
    RAISE EXCEPTION
      'D-9: % perfiles de inquilino se quedaron sin email_contacto tras copiarlo de "user". RF-C4 y R19 lo exigen: completalos antes de reintentar; esta migracion no inventa correos.',
      sin_correo;
  END IF;
END $$;
--> statement-breakpoint

ALTER TABLE "perfil_inquilino" ALTER COLUMN "email_contacto" SET NOT NULL;
--> statement-breakpoint

COMMENT ON COLUMN "perfil_propietario"."email_contacto" IS
  'D-9/R68: correo de contacto de la relacion comercial con ESTA inmobiliaria. Opcional (D-5). No es credencial de acceso: eso es user.email.';
--> statement-breakpoint
COMMENT ON COLUMN "perfil_inquilino"."email_contacto" IS
  'D-9/R69: correo de contacto exigido por RF-C4. Junto con celular y medio_preferido_contacto basta para notificar sin leer "user" (R72).';
