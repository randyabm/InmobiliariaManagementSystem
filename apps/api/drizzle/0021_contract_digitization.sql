-- 0021_contract_digitization — #18: digitalización de contratos físicos
-- (RF-CT6, RF-CT7, §13.4).

-- 0) contract.inquilino_id pasa a NULL: un contrato físico digitalizado
-- puede llegar sin perfil de inquilino en el sistema (PA-18-1).

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'contract'
      AND column_name = 'inquilino_id' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE "contract" ALTER COLUMN "inquilino_id" DROP NOT NULL;
  END IF;
END $$;
--> statement-breakpoint


CREATE TABLE IF NOT EXISTS "contract_document" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "contract_id" uuid NOT NULL REFERENCES "contract"("id"),
  "nombre" text NOT NULL,
  "origen" text NOT NULL CHECK ("origen" IN ('generado', 'digitalizado')),
  "clave_storage" text NOT NULL,
  "hash_sha256" text NOT NULL CHECK (length("hash_sha256") = 64),
  "mime" text NOT NULL,
  "tamano_bytes" bigint,
  "metadatos" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contract_document_tenant_contract_idx"
  ON "contract_document" ("tenant_id", "contract_id");
--> statement-breakpoint
ALTER TABLE "contract_document" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "contract_document" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'contract_document_tenant_isolation'
      AND tablename = 'contract_document'
  ) THEN
    CREATE POLICY "contract_document_tenant_isolation" ON "contract_document"
      USING ("tenant_id" = current_setting('app.current_tenant', true)::uuid);
  END IF;
END $$;
--> statement-breakpoint
