-- 0018_inventory_signature_pdf — #14: firma electrónica con evidencia y
-- PDF consolidado (RF-I8, RF-I9, RF-I12, RF-AU3, §10.1 Ley 527, D4).
--
-- POR QUÉ EXISTE. El PRD §8.7 cierra el ciclo del inventario con la firma
-- de ambas partes y el documento final; §10.1 exige evidencia de
-- trazabilidad (timestamp, IP, verificación de identidad) y el hash SHA-256
-- del documento. La firma es INMUTABLE (append-only) y una por parte.
--
-- QUÉ NO HACE:
--
--   * **No firma con proveedor certificado**: la implementación MVP
--     registra la evidencia (Ley 527) tras la interfaz `ServicioFirma`
--     (D4, PA-14-4); el proveedor se enchufa sin tocar el servicio.
--   * **No vincula el contrato formalmente (RF-I12)**: el PDF vive en
--     `propiedad_documento` (#6) con `tipo_documento = 'inventario_firmado'`;
--     el vínculo al contrato lo añade #17 (PA-14-2).
--   * **No versiona ni negocia**: #22.
--
-- Forward-only e idempotente (`docs/conventions.md`).

-- ───────────────────────────────────────────────────────────────────────────
-- 0) propiedad_documento: vínculo genérico de entidad (PA-14-2) — el PDF
--    firmado se localiza por su entidad (inventario), no solo por la
--    propiedad.
-- ───────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'propiedad_documento'
      AND column_name = 'entidad_tipo'
  ) THEN
    ALTER TABLE "propiedad_documento" ADD COLUMN "entidad_tipo" text;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'propiedad_documento'
      AND column_name = 'entidad_id'
  ) THEN
    ALTER TABLE "propiedad_documento" ADD COLUMN "entidad_id" uuid;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "propiedad_documento_entidad_idx"
  ON "propiedad_documento" ("tenant_id", "entidad_tipo", "entidad_id")
  WHERE "entidad_tipo" IS NOT NULL;
--> statement-breakpoint

-- ───────────────────────────────────────────────────────────────────────────
-- 1) inventario_firma (R3)
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "inventario_firma" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "inventario_id" uuid NOT NULL REFERENCES "inventario"("id"),
  "firmante_tipo" text NOT NULL CHECK ("firmante_tipo" IN ('EMPLEADO', 'INQUILINO')),
  "firmante_user_id" uuid NOT NULL REFERENCES "user"("id"),
  "hash_documento" text NOT NULL CHECK (length("hash_documento") = 64),
  "ip" text NOT NULL,
  "otp_verificado_en" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventario_firma_tenant_inventario_idx"
  ON "inventario_firma" ("tenant_id", "inventario_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inventario_firma_inventario_firmante_unique_idx"
  ON "inventario_firma" ("inventario_id", "firmante_tipo");
--> statement-breakpoint

-- ───────────────────────────────────────────────────────────────────────────
-- 2) RLS
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE "inventario_firma" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "inventario_firma" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'inventario_firma_tenant_isolation'
      AND tablename = 'inventario_firma'
  ) THEN
    CREATE POLICY "inventario_firma_tenant_isolation" ON "inventario_firma"
      USING ("tenant_id" = current_setting('app.current_tenant', true)::uuid);
  END IF;
END $$;
--> statement-breakpoint

-- ───────────────────────────────────────────────────────────────────────────
-- 3) Append-only (R3): ni el dueño puede mutar la evidencia de la firma.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION "inventario_firma_prevent_mutation"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'inventario_firma es append-only: no se permite %', TG_OP
    USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_firma_no_update" ON "inventario_firma";
--> statement-breakpoint
CREATE TRIGGER "trg_firma_no_update"
  BEFORE UPDATE ON "inventario_firma"
  FOR EACH ROW EXECUTE FUNCTION "inventario_firma_prevent_mutation"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_firma_no_delete" ON "inventario_firma";
--> statement-breakpoint
CREATE TRIGGER "trg_firma_no_delete"
  BEFORE DELETE ON "inventario_firma"
  FOR EACH ROW EXECUTE FUNCTION "inventario_firma_prevent_mutation"();
--> statement-breakpoint
