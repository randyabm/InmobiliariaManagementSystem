-- 0002_fix_rls_policy — corrige la política RLS para usar missing_ok.
--
-- La migración 0001 usó `current_setting('app.current_tenant')` sin
-- missing_ok, lo que causaba un error cuando el setting no existía.
-- Esta migración recrea la política con `current_setting(..., true)`.

DROP POLICY IF EXISTS "tenant_isolation" ON "tenant";
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenant"
  USING ("id" = current_setting('app.current_tenant', true)::uuid);
