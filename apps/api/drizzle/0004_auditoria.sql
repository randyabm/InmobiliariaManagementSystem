-- 0004_auditoria — tabla append-only de auditoría de acciones críticas.
--
-- Audit log almacena quién hizo qué, cuándo y desde dónde (RF-W4, NFR auditoría).
-- Append-only: trigger previene UPDATE y DELETE; RLS solo permite INSERT y SELECT.

CREATE TABLE IF NOT EXISTS "audit_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "actor_id" uuid,
  "actor_email" text,
  "accion" text NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" uuid,
  "metadata" jsonb,
  "ip_address" inet,
  "request_id" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'audit_log_tenant_isolation' AND tablename = 'audit_log'
  ) THEN
    CREATE POLICY "audit_log_tenant_isolation" ON "audit_log"
      FOR INSERT
      WITH CHECK ("tenant_id" = current_setting('app.current_tenant', true)::uuid);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'audit_log_select_tenant' AND tablename = 'audit_log'
  ) THEN
    CREATE POLICY "audit_log_select_tenant" ON "audit_log"
      FOR SELECT
      USING ("tenant_id" = current_setting('app.current_tenant', true)::uuid);
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_tenant_created_idx" ON "audit_log" ("tenant_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_entity_idx" ON "audit_log" ("entity_type", "entity_id");
