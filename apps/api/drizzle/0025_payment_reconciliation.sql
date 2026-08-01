-- 0025_payment_reconciliation — #30: conciliación de pagos (RF-PA1..PA15,
-- §15, D9). El sistema NO procesa pagos: es un espejo de la información
-- externa.

CREATE TABLE IF NOT EXISTS "payment_import" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "nombre_archivo" text NOT NULL,
  "nombre_origen" text NOT NULL DEFAULT 'default',
  "hash_archivo" text NOT NULL CHECK (length("hash_archivo") = 64),
  "formato_detectado" text,
  "encabezados_json" jsonb,
  "mapeo_aplicado_json" jsonb,
  "cargado_por" uuid REFERENCES "user"("id"),
  "fecha_carga" timestamptz NOT NULL DEFAULT now(),
  "total_registros" integer NOT NULL DEFAULT 0,
  "conciliados" integer NOT NULL DEFAULT 0,
  "sin_identificar" integer NOT NULL DEFAULT 0,
  "estado" text NOT NULL DEFAULT 'cargada'
    CHECK ("estado" IN ('cargada', 'mapeada', 'procesada'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_import_tenant_idx" ON "payment_import" ("tenant_id");
--> statement-breakpoint
ALTER TABLE "payment_import" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "payment_import" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'payment_import_tenant_isolation' AND tablename = 'payment_import'
  ) THEN
    CREATE POLICY "payment_import_tenant_isolation" ON "payment_import"
      USING ("tenant_id" = current_setting('app.current_tenant', true)::uuid);
  END IF;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "payment_import_fila" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "import_id" uuid NOT NULL REFERENCES "payment_import"("id"),
  "n" integer NOT NULL,
  "fila_json" jsonb NOT NULL,
  UNIQUE ("import_id", "n")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_import_fila_tenant_import_idx"
  ON "payment_import_fila" ("tenant_id", "import_id");
--> statement-breakpoint
ALTER TABLE "payment_import_fila" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "payment_import_fila" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'payment_import_fila_tenant_isolation'
      AND tablename = 'payment_import_fila'
  ) THEN
    CREATE POLICY "payment_import_fila_tenant_isolation" ON "payment_import_fila"
      USING ("tenant_id" = current_setting('app.current_tenant', true)::uuid);
  END IF;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "payment_record" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "import_id" uuid NOT NULL REFERENCES "payment_import"("id"),
  "fecha_movimiento" timestamptz NOT NULL,
  "valor" numeric(14,2) NOT NULL,
  "referencia_texto" text,
  "pagador_texto" text,
  "cuenta_destino" text,
  "medio_pago" text,
  "estado" text NOT NULL DEFAULT 'Cargado'
    CHECK ("estado" IN ('Cargado','Sugerido','Conciliado','Sin_identificar','Duplicado','Descartado')),
  "contract_id" uuid REFERENCES "contract"("id"),
  "estrategia_conciliacion" text,
  "confianza" numeric(4,3),
  "conciliado_por" uuid REFERENCES "user"("id"),
  "fecha_conciliacion" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_record_tenant_contract_idx"
  ON "payment_record" ("tenant_id", "contract_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_record_tenant_import_idx"
  ON "payment_record" ("tenant_id", "import_id");
--> statement-breakpoint
ALTER TABLE "payment_record" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "payment_record" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'payment_record_tenant_isolation' AND tablename = 'payment_record'
  ) THEN
    CREATE POLICY "payment_record_tenant_isolation" ON "payment_record"
      USING ("tenant_id" = current_setting('app.current_tenant', true)::uuid);
  END IF;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "payment_mapping_profile" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "nombre_origen" text NOT NULL,
  "mapeo_columnas_json" jsonb NOT NULL,
  "activo" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("tenant_id", "nombre_origen")
);
--> statement-breakpoint
ALTER TABLE "payment_mapping_profile" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "payment_mapping_profile" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'payment_mapping_profile_tenant_isolation'
      AND tablename = 'payment_mapping_profile'
  ) THEN
    CREATE POLICY "payment_mapping_profile_tenant_isolation" ON "payment_mapping_profile"
      USING ("tenant_id" = current_setting('app.current_tenant', true)::uuid);
  END IF;
END $$;
--> statement-breakpoint
