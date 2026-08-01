-- 0016_inventory_creation — #12: creación del inventario (RF-I1, RF-I3,
-- RF-I7, RF-I24, §8.7). Cubre R1, R2 y R3.
--
-- POR QUÉ EXISTE. El PRD §8.8: «la plantilla es el molde; el inventario la
-- instancia rellena». Esta migración crea las tablas del inventario; la
-- materialización (copiar la plantilla vigente al snapshot) la hace el
-- servicio en la misma transacción del alta (R4).
--
-- QUÉ NO HACE:
--
--   * **No implementa las transiciones de estado** (ENVIADO → … → CERRADO):
--     son #13/#14. El estado nace en BORRADOR (PA-12-1).
--   * **No versiona (RF-I6, #22) ni compara (RF-I10, #21)**.
--   * **No guarda binarios**: las fotos viven en object storage (#6); la
--     base guarda clave, hash y autor (R3).
--
-- Forward-only e idempotente (`docs/conventions.md`).

-- ───────────────────────────────────────────────────────────────────────────
-- 1) inventario (R1)
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "inventario" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "propiedad_id" uuid NOT NULL REFERENCES "propiedad"("id"),
  "tipo_evento" text NOT NULL CHECK ("tipo_evento" IN ('ENTREGA', 'DEVOLUCION')),
  "estado" text NOT NULL DEFAULT 'BORRADOR'
    CHECK ("estado" IN ('BORRADOR', 'ENVIADO', 'EN_REVISION', 'EN_NEGOCIACION', 'ACORDADO', 'FIRMADO', 'CERRADO')),
  "creado_por" uuid REFERENCES "user"("id"),
  "revision_completada_en" timestamptz,
  "activo" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventario_tenant_propiedad_estado_idx"
  ON "inventario" ("tenant_id", "propiedad_id", "estado");
--> statement-breakpoint

-- ───────────────────────────────────────────────────────────────────────────
-- 2) inventario_zona e inventario_item (R2) — el snapshot
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "inventario_zona" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "inventario_id" uuid NOT NULL REFERENCES "inventario"("id"),
  "nombre" text NOT NULL CHECK (length("nombre") > 0),
  "repetible" boolean NOT NULL DEFAULT false,
  "orden" integer NOT NULL DEFAULT 0,
  "plantilla_zona_id" uuid,
  "activo" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventario_zona_tenant_inventario_idx"
  ON "inventario_zona" ("tenant_id", "inventario_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "inventario_item" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "zona_id" uuid NOT NULL REFERENCES "inventario_zona"("id"),
  "nombre" text NOT NULL,
  "field_type" text NOT NULL
    CHECK ("field_type" IN ('estado', 'si_no', 'si_no_estado', 'conteo', 'seleccion', 'texto')),
  "opciones_json" jsonb,
  "estado_checklist" text CHECK ("estado_checklist" IN ('BUENO', 'REGULAR', 'MALO')),
  "valor_respuesta" jsonb,
  "comentario" text,
  "foto_obligatoria" boolean NOT NULL DEFAULT false,
  "plantilla_item_id" uuid,
  "creado_offline" boolean NOT NULL DEFAULT false,
  "sincronizado_en" timestamptz,
  "activo" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inventario_item_opciones_check'
  ) THEN
    ALTER TABLE "inventario_item" ADD CONSTRAINT "inventario_item_opciones_check"
      CHECK (("field_type" = 'seleccion') = ("opciones_json" IS NOT NULL));
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventario_item_tenant_zona_idx"
  ON "inventario_item" ("tenant_id", "zona_id");
--> statement-breakpoint

-- ───────────────────────────────────────────────────────────────────────────
-- 3) inventario_item_foto (R3)
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "inventario_item_foto" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "item_id" uuid NOT NULL REFERENCES "inventario_item"("id"),
  "clave_storage" text NOT NULL,
  "hash_sha256" text NOT NULL,
  "autor" text NOT NULL CHECK ("autor" IN ('EMPLEADO', 'INQUILINO')),
  "revision_id" uuid,
  "activo" boolean NOT NULL DEFAULT true,
  "fecha_captura" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventario_item_foto_tenant_item_idx"
  ON "inventario_item_foto" ("tenant_id", "item_id");
--> statement-breakpoint

-- ───────────────────────────────────────────────────────────────────────────
-- 4) RLS en las cuatro tablas (R1, R2, R3)
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE "inventario" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "inventario" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "inventario_zona" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "inventario_zona" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "inventario_item" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "inventario_item" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "inventario_item_foto" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "inventario_item_foto" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'inventario_tenant_isolation' AND tablename = 'inventario'
  ) THEN
    CREATE POLICY "inventario_tenant_isolation" ON "inventario"
      USING ("tenant_id" = current_setting('app.current_tenant', true)::uuid);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'inventario_zona_tenant_isolation'
      AND tablename = 'inventario_zona'
  ) THEN
    CREATE POLICY "inventario_zona_tenant_isolation" ON "inventario_zona"
      USING ("tenant_id" = current_setting('app.current_tenant', true)::uuid);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'inventario_item_tenant_isolation'
      AND tablename = 'inventario_item'
  ) THEN
    CREATE POLICY "inventario_item_tenant_isolation" ON "inventario_item"
      USING ("tenant_id" = current_setting('app.current_tenant', true)::uuid);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'inventario_item_foto_tenant_isolation'
      AND tablename = 'inventario_item_foto'
  ) THEN
    CREATE POLICY "inventario_item_foto_tenant_isolation" ON "inventario_item_foto"
      USING ("tenant_id" = current_setting('app.current_tenant', true)::uuid);
  END IF;
END $$;
--> statement-breakpoint
