-- 0022_contract_renewals — #19: renovaciones y alertas de vencimiento
-- (RF-CT8..CT13, §13.5, Ley 820).

CREATE TABLE IF NOT EXISTS "config_renovacion" (
  "tenant_id" uuid PRIMARY KEY REFERENCES "tenant"("id"),
  "umbrales_dias" jsonb NOT NULL DEFAULT '[90,60,30]',
  "avisar_a" jsonb NOT NULL DEFAULT '["admin","asesor"]',
  "ipc_anual" numeric(5,2) NOT NULL DEFAULT 0,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "config_renovacion" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "config_renovacion" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'config_renovacion_tenant_isolation'
      AND tablename = 'config_renovacion'
  ) THEN
    CREATE POLICY "config_renovacion_tenant_isolation" ON "config_renovacion"
      USING ("tenant_id" = current_setting('app.current_tenant', true)::uuid);
  END IF;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "alerta_vencimiento" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "contract_id" uuid NOT NULL REFERENCES "contract"("id"),
  "umbral_dias" integer NOT NULL,
  "enviada_en" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("contract_id", "umbral_dias")
);
--> statement-breakpoint
ALTER TABLE "alerta_vencimiento" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "alerta_vencimiento" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'alerta_vencimiento_tenant_isolation'
      AND tablename = 'alerta_vencimiento'
  ) THEN
    CREATE POLICY "alerta_vencimiento_tenant_isolation" ON "alerta_vencimiento"
      USING ("tenant_id" = current_setting('app.current_tenant', true)::uuid);
  END IF;
END $$;
--> statement-breakpoint
