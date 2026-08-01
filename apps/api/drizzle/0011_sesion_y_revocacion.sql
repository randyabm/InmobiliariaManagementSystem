-- 0011_sesion_y_revocacion — #27: sesiones, refresh tokens y revocación
-- inmediata. Cubre R1, R2, R10 y R18.
--
-- POR QUÉ EXISTE. El JWT es un dato firmado pero VIEJO: el rol se validaba
-- contra la base solo en la emisión (PA-3, feature #26), así que si un rol se
-- revocaba después, el token ya emitido lo seguía concediendo hasta expirar.
-- El humano no aceptó esa ventana: esta migración crea el estado vivo que
-- hace la revocación inmediata (R4): una sesión por login (su `id` es el
-- claim `jti` del access token) y una versión por identidad
-- (`user.token_version`, claim `ver`).
--
-- QUÉ NO HACE:
--
--   * **No toca `user_role` ni `roles.guard.ts`**: la revocación de un rol es
--     `activo = false` + incremento de versión en la misma transacción
--     (R12); el guard sigue decidiendo con los claims y no se toca (R15).
--   * **No toca `audit_log`**: las acciones de sesión se auditan desde el
--     servicio con `AuditService` (R13).
--
-- Forward-only e idempotente (`docs/conventions.md`).

-- ───────────────────────────────────────────────────────────────────────────
-- 1) sesion (R1)
-- ───────────────────────────────────────────────────────────────────────────
--
-- `refresh_token_hash_anterior` es la huella del refresh ROTADO: sirve para
-- detectar reuso (R8) — si alguien reenvía un refresh que ya se rotó, la
-- sesión completa se revoca. En la base solo viven hashes SHA-256, nunca el
-- token en claro (R10).
--
-- El UNIQUE sobre `refresh_token_hash` es parcial porque la huella anterior
-- también podría colisionar... no: la huella anterior NO es única (dos
-- sesiones pueden compartir histórico de rotación). El índice parcial
-- garantiza la búsqueda por hash vigente con O(1) y sin duplicados.
--
-- El CHECK de coherencia impide el estado a medias "revocada sin motivo" o
-- "motivo sin revocación".

CREATE TABLE IF NOT EXISTS "sesion" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "user"("id"),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "refresh_token_hash" text,
  "refresh_token_hash_anterior" text,
  "expira_en" timestamptz NOT NULL,
  "revocada_at" timestamptz,
  "motivo_revocacion" text,
  "last_used_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sesion_refresh_token_hash_key"
  ON "sesion" ("refresh_token_hash")
  WHERE "refresh_token_hash" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sesion_tenant_user_idx"
  ON "sesion" ("tenant_id", "user_id");
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sesion_revocacion_coherente_check'
  ) THEN
    ALTER TABLE "sesion" ADD CONSTRAINT "sesion_revocacion_coherente_check"
      CHECK (("revocada_at" IS NULL) = ("motivo_revocacion" IS NULL));
  END IF;
END $$;
--> statement-breakpoint

-- ───────────────────────────────────────────────────────────────────────────
-- 2) user.token_version (R2)
-- ───────────────────────────────────────────────────────────────────────────
--
-- Se incrementa en la MISMA transacción que revoca un rol (R12): no existe
-- el instante en que el rol está revocado y la versión no ha subido.

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "token_version" integer NOT NULL DEFAULT 0;
--> statement-breakpoint

-- ───────────────────────────────────────────────────────────────────────────
-- 3) RLS en sesion (R1, R14)
-- ───────────────────────────────────────────────────────────────────────────
--
-- ENABLE + FORCE + política por tenant_id, en esta misma migración
-- (docs/conventions.md). Una sesión de una inmobiliaria nunca es visible
-- desde otra; la validación de acceso (R4) corre dentro de SET LOCAL y la
-- frontera R14 la sostiene el motor.

ALTER TABLE "sesion" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "sesion" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'sesion_tenant_isolation'
      AND tablename = 'sesion'
  ) THEN
    CREATE POLICY "sesion_tenant_isolation" ON "sesion"
      USING ("tenant_id" = current_setting('app.current_tenant', true)::uuid);
  END IF;
END $$;
--> statement-breakpoint

-- ───────────────────────────────────────────────────────────────────────────
-- 4) sesion_por_refresh_token (R18)
-- ───────────────────────────────────────────────────────────────────────────
--
-- Segunda —y última— vía de lectura que evita el RLS en todo el sistema,
-- después de `tenant_por_codigo` (0007, R52). Motivo: POST /auth/refresh no
-- tiene access token y no puede conocer el tenant hasta que encuentra la
-- sesión; la política filtraría por un contexto que todavía no existe.
--
-- Devuelve SOLO el bootstrap mínimo para fijar contexto
-- (id, user_id, tenant_id, expira_en, revocada_at), por COINCIDENCIA EXACTA
-- de hash (nunca LIKE ni substring: eso convertiría la función en un
-- enumerador de sesiones). El servicio que la invoca reabre la sesión DENTRO
-- de una transacción con SET LOCAL del tenant devuelto y revalida todo antes
-- de rotar (R19): la función no es la única barrera, solo el arranque.
--
-- No se concede a PUBLIC y el arnés verifica que no haya ninguna OTRA
-- función SECURITY DEFINER nueva (migrations.db.test.ts).

CREATE OR REPLACE FUNCTION sesion_por_refresh_token(p_hash text)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  tenant_id uuid,
  expira_en timestamptz,
  revocada_at timestamptz
) AS $fn$
  SELECT s."id", s."user_id", s."tenant_id", s."expira_en", s."revocada_at"
    FROM "sesion" s
   WHERE s."refresh_token_hash" = p_hash
      OR s."refresh_token_hash_anterior" = p_hash;
$fn$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp;
--> statement-breakpoint

COMMENT ON FUNCTION sesion_por_refresh_token(text) IS
  'R18/#27: unica ruta del refresh previa al tenant (patron R52). Coincidencia exacta de hash SHA-256 sobre sesion.refresh_token_hash o su huella anterior (deteccion de reuso, R8). Devuelve solo el bootstrap para fijar app.current_tenant; el servicio revalida la sesion dentro del RLS antes de rotar (R19). REVOKE de PUBLIC en esta migracion; no exponer ninguna otra.';
--> statement-breakpoint

REVOKE ALL ON FUNCTION sesion_por_refresh_token(text) FROM PUBLIC;
--> statement-breakpoint

COMMENT ON COLUMN "user"."token_version" IS
  'R2/#27: version de la identidad. Se incrementa en la misma transaccion que revoca un rol (R12); todo access token lleva el claim ver y la validacion de sesion rechaza con 401 los tokens con version vieja (R4).';
