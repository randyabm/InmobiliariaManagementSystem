-- 0024_inventory_versioning — #22: versionado ante cada ronda de
-- negociación (RF-I6, §8.7).

CREATE TABLE IF NOT EXISTS "inventario_version" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "inventario_id" uuid NOT NULL REFERENCES "inventario"("id"),
  "version" integer NOT NULL,
  "snapshot_json" jsonb NOT NULL,
  "creado_por" uuid REFERENCES "user"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("inventario_id", "version")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventario_version_tenant_inventario_idx"
  ON "inventario_version" ("tenant_id", "inventario_id");
--> statement-breakpoint
ALTER TABLE "inventario_version" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "inventario_version" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'inventario_version_tenant_isolation'
      AND tablename = 'inventario_version'
  ) THEN
    CREATE POLICY "inventario_version_tenant_isolation" ON "inventario_version"
      USING ("tenant_id" = current_setting('app.current_tenant', true)::uuid);
  END IF;
END $$;
--> statement-breakpoint
