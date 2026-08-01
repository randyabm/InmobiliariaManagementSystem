-- 0020_contract_generation_signature — #17: contrato por merge y firma
-- (RF-CT3, RF-CT4, RF-CT5, RF-I12, §13.3, Ley 527).
--
-- QUÉ NO HACE: digitalización (#18), renovaciones (#19).


CREATE TABLE IF NOT EXISTS "contract" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "property_id" uuid NOT NULL REFERENCES "propiedad"("id"),
  "inquilino_id" uuid NOT NULL REFERENCES "perfil_inquilino"("id"),
  "propietario_id" uuid NOT NULL REFERENCES "perfil_propietario"("id"),
  "fecha_inicio" timestamptz NOT NULL,
  "fecha_fin" timestamptz NOT NULL,
  "estado" text NOT NULL DEFAULT 'vigente'
    CHECK ("estado" IN ('vigente', 'firmado')),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contract_tenant_property_idx"
  ON "contract" ("tenant_id", "property_id");
--> statement-breakpoint
ALTER TABLE "contract" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "contract" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'contract_tenant_isolation' AND tablename = 'contract'
  ) THEN
    CREATE POLICY "contract_tenant_isolation" ON "contract"
      USING ("tenant_id" = current_setting('app.current_tenant', true)::uuid);
  END IF;
END $$;
--> statement-breakpoint

-- 0b) propiedad_documento: vínculo del inventario firmado como ANEXO del
-- contrato (RF-I12, PA-17-3). El UNIQUE de clave_storage impide duplicar
-- el objeto: el anexo es el MISMO documento con este vínculo.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'propiedad_documento'
      AND column_name = 'anexo_de_contrato_id'
  ) THEN
    ALTER TABLE "propiedad_documento" ADD COLUMN "anexo_de_contrato_id" uuid
      REFERENCES "contract"("id");
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "propiedad_documento_anexo_idx"
  ON "propiedad_documento" ("tenant_id", "anexo_de_contrato_id")
  WHERE "anexo_de_contrato_id" IS NOT NULL;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "contrato_firma" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "contract_id" uuid NOT NULL REFERENCES "contract"("id"),
  "firmante_tipo" text NOT NULL CHECK ("firmante_tipo" IN ('EMPLEADO', 'INQUILINO')),
  "firmante_user_id" uuid NOT NULL REFERENCES "user"("id"),
  "hash_documento" text NOT NULL CHECK (length("hash_documento") = 64),
  "ip" text NOT NULL,
  "otp_verificado_en" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contrato_firma_contract_firmante_unique_idx"
  ON "contrato_firma" ("contract_id", "firmante_tipo");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contrato_firma_tenant_contract_idx"
  ON "contrato_firma" ("tenant_id", "contract_id");
--> statement-breakpoint
ALTER TABLE "contrato_firma" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "contrato_firma" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'contrato_firma_tenant_isolation'
      AND tablename = 'contrato_firma'
  ) THEN
    CREATE POLICY "contrato_firma_tenant_isolation" ON "contrato_firma"
      USING ("tenant_id" = current_setting('app.current_tenant', true)::uuid);
  END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "contrato_firma_prevent_mutation"()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'contrato_firma es append-only: no se permite %', TG_OP
    USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_contrato_firma_no_update" ON "contrato_firma";
--> statement-breakpoint
CREATE TRIGGER "trg_contrato_firma_no_update"
  BEFORE UPDATE ON "contrato_firma"
  FOR EACH ROW EXECUTE FUNCTION "contrato_firma_prevent_mutation"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_contrato_firma_no_delete" ON "contrato_firma";
--> statement-breakpoint
CREATE TRIGGER "trg_contrato_firma_no_delete"
  BEFORE DELETE ON "contrato_firma"
  FOR EACH ROW EXECUTE FUNCTION "contrato_firma_prevent_mutation"();
--> statement-breakpoint
