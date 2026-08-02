-- 0028_web_embedding_cors — #32 (frontera RF-INT4): CORS por tenant.
-- El middleware de CORS resuelve el tenant DESDE el Origin: para eso
-- necesita una consulta cross-tenant, la 5ª vía SECURITY DEFINER.

CREATE OR REPLACE FUNCTION "tenant_dominio_por_origen"(p_dominio text)
RETURNS TABLE (tenant_id uuid, paquete_web text, activo boolean)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d.tenant_id, d.paquete_web, d.activo
    FROM tenant_dominio d
   WHERE d.dominio = p_dominio
   LIMIT 1;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "tenant_dominio_por_origen"(text) FROM PUBLIC;
--> statement-breakpoint
