-- 0017_inventory_tenant_review — #13: invitación, cuenta persistente con
-- OTP y revisión del inquilino (RF-I4, RF-I5, RF-AU2 actualizado, RF-AU3,
-- RF-AU5, §8.7).
--
-- POR QUÉ EXISTE. El PRD §8.7: «el inquilino recibe un link seguro con
-- expiración», revisa ítem por ítem (aceptar/objetar con comentario y
-- foto) y su identidad se verifica por OTP antes de firmar (RF-AU3). La
-- revisión es una sola ronda (PA-13-2); la negociación multironda es #22.
--
-- QUÉ NO HACE:
--
--   * **No firma ni genera PDF** (RF-I8/I9/I12): #14. Aquí solo se entrega
--     la infraestructura de OTP con propósito `FIRMA` (R8).
--   * **No versiona** (RF-I6, #22) **ni compara** (RF-I10, #21).
--   * **No guarda códigos ni tokens en claro** (R12): solo hashes SHA-256.
--
-- Forward-only e idempotente (`docs/conventions.md`).

-- ───────────────────────────────────────────────────────────────────────────
-- 0) inventario: el inquilino objetivo del inventario (scoping R9) y
--    `revision_completada_en` si algún día faltara (R7).
-- ───────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'inventario'
      AND column_name = 'perfil_inquilino_id'
  ) THEN
    ALTER TABLE "inventario" ADD COLUMN "perfil_inquilino_id" uuid
      REFERENCES "perfil_inquilino"("id");
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'inventario'
      AND column_name = 'revision_completada_en'
  ) THEN
    ALTER TABLE "inventario" ADD COLUMN "revision_completada_en" timestamptz;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventario_tenant_perfil_idx"
  ON "inventario" ("tenant_id", "perfil_inquilino_id")
  WHERE "perfil_inquilino_id" IS NOT NULL;
--> statement-breakpoint

-- ───────────────────────────────────────────────────────────────────────────
-- 1) invitacion_inventario (R1)
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "invitacion_inventario" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "inventario_id" uuid NOT NULL REFERENCES "inventario"("id"),
  "perfil_inquilino_id" uuid NOT NULL REFERENCES "perfil_inquilino"("id"),
  "token_hash" text NOT NULL CHECK (length("token_hash") = 64),
  "expira_en" timestamptz NOT NULL,
  "usada_en" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invitacion_inventario_tenant_idx"
  ON "invitacion_inventario" ("tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invitacion_inventario_token_hash_unique_idx"
  ON "invitacion_inventario" ("token_hash");
--> statement-breakpoint

-- ───────────────────────────────────────────────────────────────────────────
-- 2) codigo_otp (R4, R5, R8)
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "codigo_otp" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "user_id" uuid NOT NULL REFERENCES "user"("id"),
  "proposito" text NOT NULL CHECK ("proposito" IN ('REGISTRO', 'LOGIN', 'FIRMA')),
  "codigo_hash" text NOT NULL CHECK (length("codigo_hash") = 64),
  "expira_en" timestamptz NOT NULL,
  "verificado_en" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "codigo_otp_tenant_user_idx"
  ON "codigo_otp" ("tenant_id", "user_id", "proposito");
--> statement-breakpoint

-- ───────────────────────────────────────────────────────────────────────────
-- 3) inventario_item_revision (R6, PA-13-2)
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "inventario_item_revision" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "item_id" uuid NOT NULL REFERENCES "inventario_item"("id"),
  "perfil_inquilino_id" uuid NOT NULL REFERENCES "perfil_inquilino"("id"),
  "respuesta" text NOT NULL CHECK ("respuesta" IN ('ACEPTADO', 'OBJETADO')),
  "comentario" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventario_item_revision_tenant_item_idx"
  ON "inventario_item_revision" ("tenant_id", "item_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventario_item_revision_tenant_perfil_idx"
  ON "inventario_item_revision" ("tenant_id", "perfil_inquilino_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inventario_item_revision_item_perfil_unique_idx"
  ON "inventario_item_revision" ("item_id", "perfil_inquilino_id");
--> statement-breakpoint

-- ───────────────────────────────────────────────────────────────────────────
-- 4) RLS en las tres tablas
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE "invitacion_inventario" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "invitacion_inventario" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "codigo_otp" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "codigo_otp" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "inventario_item_revision" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "inventario_item_revision" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'invitacion_inventario_tenant_isolation'
      AND tablename = 'invitacion_inventario'
  ) THEN
    CREATE POLICY "invitacion_inventario_tenant_isolation" ON "invitacion_inventario"
      USING ("tenant_id" = current_setting('app.current_tenant', true)::uuid);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'codigo_otp_tenant_isolation' AND tablename = 'codigo_otp'
  ) THEN
    CREATE POLICY "codigo_otp_tenant_isolation" ON "codigo_otp"
      USING ("tenant_id" = current_setting('app.current_tenant', true)::uuid);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'inventario_item_revision_tenant_isolation'
      AND tablename = 'inventario_item_revision'
  ) THEN
    CREATE POLICY "inventario_item_revision_tenant_isolation" ON "inventario_item_revision"
      USING ("tenant_id" = current_setting('app.current_tenant', true)::uuid);
  END IF;
END $$;
--> statement-breakpoint

-- ───────────────────────────────────────────────────────────────────────────
-- 5) 4ª vía SECURITY DEFINER (PA-13-4): invitacion_por_token(hash)
-- ───────────────────────────────────────────────────────────────────────────
-- La invitación se consume SIN sesión y SIN tenant conocido: la función
-- valida la coincidencia exacta del hash y devuelve solo el bootstrap; el
-- flujo abre transacción con `SET LOCAL` del tenant y revalida DENTRO del
-- RLS (patrón R52/R18 de `tenant_por_codigo`).

CREATE OR REPLACE FUNCTION "invitacion_por_token"(p_token_hash text)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  inventario_id uuid,
  perfil_inquilino_id uuid,
  expira_en timestamptz,
  usada_en timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    SELECT i.id, i.tenant_id, i.inventario_id, i.perfil_inquilino_id,
           i.expira_en, i.usada_en
      FROM invitacion_inventario i
     WHERE i.token_hash = p_token_hash;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "invitacion_por_token"(text) FROM PUBLIC;
--> statement-breakpoint
