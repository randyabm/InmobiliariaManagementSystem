-- 0001_tenant_rls — primera tabla de negocio con Row-Level Security.
--
-- Forward-only e idempotente (docs/conventions.md).
-- La política RLS filtra por `app.current_tenant` establecido vía
-- `SET LOCAL` en la conexión (D2, design.md §3).
-- `current_setting('app.current_tenant', true)` retorna NULL si no está
-- establecido, lo que hace que la política retorne 0 filas (no error).

CREATE TABLE IF NOT EXISTS "tenant" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "nombre" text NOT NULL,
  "nit" text NOT NULL UNIQUE,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "tenant" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tenant" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'tenant_isolation' AND tablename = 'tenant'
  ) THEN
    CREATE POLICY "tenant_isolation" ON "tenant"
      USING ("id" = current_setting('app.current_tenant', true)::uuid);
  END IF;
END $$;
