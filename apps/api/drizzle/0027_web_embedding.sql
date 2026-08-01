-- 0027_web_embedding — #32: integración WordPress y portales embebibles
-- (RF-INT1..INT6, §6.6, D7).

CREATE TABLE IF NOT EXISTS "tenant_dominio" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "dominio" text NOT NULL,
  "paquete_web" text NOT NULL DEFAULT 'portal_inquilino'
    CHECK ("paquete_web" IN ('portal_inquilino','portal_propietario','web_completo')),
  "logo_url" text,
  "colores_json" jsonb,
  "activo" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("tenant_id", "dominio")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_dominio_tenant_idx" ON "tenant_dominio" ("tenant_id");
--> statement-breakpoint
ALTER TABLE "tenant_dominio" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tenant_dominio" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'tenant_dominio_tenant_isolation' AND tablename = 'tenant_dominio'
  ) THEN
    CREATE POLICY "tenant_dominio_tenant_isolation" ON "tenant_dominio"
      USING ("tenant_id" = current_setting('app.current_tenant', true)::uuid);
  END IF;
END $$;
--> statement-breakpoint
