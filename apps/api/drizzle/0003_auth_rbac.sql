-- 0003_auth_rbac — tablas user y user_role con Row-Level Security.
--
-- User almacena credenciales; UserRole define roles por tenant (RF-C2, RF-C3, RF-AU6).
-- Ambas tablas tienen RLS habilitado y forzado.
-- user_role filtra por tenant_id; user filtra por user_role del tenant actual.

CREATE TABLE IF NOT EXISTS "user" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "email" text NOT NULL UNIQUE,
  "password_hash" text NOT NULL,
  "nombre" text NOT NULL,
  "telefono" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_role" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "user"("id"),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "rol" text NOT NULL,
  "activo" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "user_role_user_tenant_rol_key" UNIQUE("user_id", "tenant_id", "rol")
);
--> statement-breakpoint
ALTER TABLE "user" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "user" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "user_role" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "user_role" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'user_role_tenant_isolation' AND tablename = 'user_role'
  ) THEN
    CREATE POLICY "user_role_tenant_isolation" ON "user_role"
      USING ("tenant_id" = current_setting('app.current_tenant', true)::uuid);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'user_tenant_isolation' AND tablename = 'user'
  ) THEN
    CREATE POLICY "user_tenant_isolation" ON "user"
      FOR ALL
      USING ("id" IN (
        SELECT "user_id" FROM "user_role"
        WHERE "tenant_id" = current_setting('app.current_tenant', true)::uuid
          AND "activo" = true
      ));
  END IF;
END $$;
