-- 0019_contract_templates — #16: clausulado común y plantilla por
-- propiedad (RF-CT1, RF-CT2, §13.2).
--
-- POR QUÉ EXISTE. §13.2: el clausulado se valida UNA vez al ingresar la
-- propiedad; `property_id` NULL es la base del tenant (una por tenant) y
-- la copia con propiedad es el template pre-relleno (PA-16-1).
--
-- QUÉ NO HACE: merge/PDF (#17), firma (#17), digitalización (#18),
-- renovaciones (#19).
--
-- Forward-only e idempotente.

CREATE TABLE IF NOT EXISTS "contract_template" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "property_id" uuid REFERENCES "propiedad"("id"),
  "nombre" text NOT NULL,
  "cuerpo" text NOT NULL,
  "merge_fields_json" jsonb NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "validado_por" uuid REFERENCES "user"("id"),
  "estado" text NOT NULL DEFAULT 'borrador'
    CHECK ("estado" IN ('borrador', 'validado')),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contract_template_tenant_base_key"
  ON "contract_template" ("tenant_id") WHERE "property_id" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contract_template_tenant_property_key"
  ON "contract_template" ("tenant_id", "property_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contract_template_tenant_idx"
  ON "contract_template" ("tenant_id");
--> statement-breakpoint

ALTER TABLE "contract_template" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "contract_template" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'contract_template_tenant_isolation'
      AND tablename = 'contract_template'
  ) THEN
    CREATE POLICY "contract_template_tenant_isolation" ON "contract_template"
      USING ("tenant_id" = current_setting('app.current_tenant', true)::uuid);
  END IF;
END $$;
--> statement-breakpoint
