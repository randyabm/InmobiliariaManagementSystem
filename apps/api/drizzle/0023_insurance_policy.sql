-- 0023_insurance_policy — #20: afianzamiento y captura de póliza
-- (RF-PI7, RF-PI8, §12.4).

CREATE TABLE IF NOT EXISTS "insurance_policy" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "property_id" uuid NOT NULL REFERENCES "propiedad"("id"),
  "contract_id" uuid REFERENCES "contract"("id"),
  "aseguradora" text NOT NULL,
  "numero_poliza" text,
  "vigencia_desde" timestamptz,
  "vigencia_hasta" timestamptz,
  "valor_cobertura" numeric(14,2),
  "estado" text NOT NULL DEFAULT 'en_estudio'
    CHECK ("estado" IN ('en_estudio', 'aprobada', 'rechazada')),
  "observaciones" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "insurance_policy_vigencia_check"
    CHECK ("vigencia_hasta" IS NULL OR "vigencia_desde" IS NULL
           OR "vigencia_hasta" > "vigencia_desde")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "insurance_policy_tenant_property_idx"
  ON "insurance_policy" ("tenant_id", "property_id");
--> statement-breakpoint
ALTER TABLE "insurance_policy" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "insurance_policy" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'insurance_policy_tenant_isolation'
      AND tablename = 'insurance_policy'
  ) THEN
    CREATE POLICY "insurance_policy_tenant_isolation" ON "insurance_policy"
      USING ("tenant_id" = current_setting('app.current_tenant', true)::uuid);
  END IF;
END $$;
--> statement-breakpoint
