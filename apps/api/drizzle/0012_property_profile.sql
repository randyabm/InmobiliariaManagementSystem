-- 0012_property_profile — #6: hoja de vida del inmueble. Cubre R1, R2, R3 y R4.
--
-- POR QUÉ EXISTE. RF-P1: la ficha de propiedad es un expediente completo con
-- cuatro grupos de datos (identificación, comercial, administración PH y
-- contable). Cierra la dependencia explícita que la #5 dejó escrita en su
-- design.md §6: la columna `propiedad.cuenta_bancaria_id` (override de la
-- cuenta de giro) y la regla de precedencia que #5 entregó probada.
--
-- QUÉ NO HACE:
--
--   * **No añade `estado`** (ciclo de vida, RF-P4): es la feature #8 sobre el
--     motor de workflows. La ficha queda lista para que #8 lo añada.
--   * **No añade columnas de retención**: la tarifa es configuración del
--     tenant y año (#25 R5 aplica el mismo criterio: la tarifa vive en un
--     solo sitio; `sujeto_retencion` está en el perfil).
--   * **No digitaliza contratos** (§13.4): es la feature #18. Aquí solo vive
--     el repositorio documental (RF-P3) al que #18 escribirá.
--   * **No guarda binarios**: fotos y documentos viven en object storage
--     (MinIO); la base guarda claves y hashes (R4, R13, R17).
--
-- Forward-only e idempotente (`docs/conventions.md`).

-- ───────────────────────────────────────────────────────────────────────────
-- 1) propiedad (R1)
-- ───────────────────────────────────────────────────────────────────────────
--
-- `canon`, `valor_administracion`, `area` e `incremento_anual_pactado` son
-- `numeric` (R9), nunca float: dinero y área no se transportan como `number`
-- de JavaScript. `propietario_principal_id` es contra quien se resuelve la
-- cuenta de giro (R8); los propietarios adicionales viven en la tabla puente.
-- `fotos` son claves de object storage (text[]).

CREATE TABLE IF NOT EXISTS "propiedad" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "direccion" text NOT NULL,
  "tipo" text NOT NULL CHECK ("tipo" IN ('APARTAMENTO', 'CASA', 'LOCAL', 'OFICINA', 'BODEGA', 'PARQUEADERO')),
  "area" numeric(10,2) NOT NULL CHECK ("area" > 0),
  "matricula_inmobiliaria" text,
  "estrato" integer CHECK ("estrato" BETWEEN 1 AND 6),
  "parqueaderos" integer NOT NULL DEFAULT 0,
  "depositos" integer NOT NULL DEFAULT 0,
  "fotos" text[] NOT NULL DEFAULT '{}',
  "canon" numeric(12,2) NOT NULL CHECK ("canon" >= 0),
  "valor_administracion" numeric(12,2),
  "canon_incluye_administracion" boolean NOT NULL DEFAULT false,
  "incremento_anual_pactado" numeric(5,2),
  "nombre_conjunto" text,
  "contacto_admin_nombre" text,
  "contacto_admin_telefono" text,
  "contacto_admin_correo" text,
  "propietario_principal_id" uuid NOT NULL REFERENCES "perfil_propietario"("id"),
  "cuenta_bancaria_id" uuid REFERENCES "cuenta_bancaria"("id"),
  "inquilino_actual_id" uuid REFERENCES "perfil_inquilino"("id"),
  "activo" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "propiedad_tenant_idx" ON "propiedad" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "propiedad_principal_idx"
  ON "propiedad" ("tenant_id", "propietario_principal_id");
--> statement-breakpoint

-- ───────────────────────────────────────────────────────────────────────────
-- 2) propiedad_propietario (R2)
-- ───────────────────────────────────────────────────────────────────────────
--
-- Propietarios ADICIONALES (RF-P2 "propietario(s)", PA-6-2). El principal
-- vive en la ficha; esta tabla no puede duplicarlo (se valida en el service,
-- y la UNIQUE impide dobles asociaciones).

CREATE TABLE IF NOT EXISTS "propiedad_propietario" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "propiedad_id" uuid NOT NULL REFERENCES "propiedad"("id"),
  "perfil_propietario_id" uuid NOT NULL REFERENCES "perfil_propietario"("id"),
  "activo" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "propiedad_propietario_unico_key"
  ON "propiedad_propietario" ("propiedad_id", "perfil_propietario_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "propiedad_propietario_tenant_idx"
  ON "propiedad_propietario" ("tenant_id", "propiedad_id");
--> statement-breakpoint

-- ───────────────────────────────────────────────────────────────────────────
-- 3) historial_ocupacion (R3)
-- ───────────────────────────────────────────────────────────────────────────
--
-- Índice único PARCIAL (`WHERE hasta IS NULL`): a lo sumo una ocupación
-- vigente por propiedad. La transacción que asigna el inquilino actual cierra
-- y abre líneas a la vez (R11): el motor impide el estado a medias.

CREATE TABLE IF NOT EXISTS "historial_ocupacion" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "propiedad_id" uuid NOT NULL REFERENCES "propiedad"("id"),
  "perfil_inquilino_id" uuid NOT NULL REFERENCES "perfil_inquilino"("id"),
  "desde" timestamptz NOT NULL,
  "hasta" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "historial_ocupacion_vigente_key"
  ON "historial_ocupacion" ("propiedad_id")
  WHERE "hasta" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "historial_ocupacion_propiedad_desde_idx"
  ON "historial_ocupacion" ("propiedad_id", "desde");
--> statement-breakpoint

-- ───────────────────────────────────────────────────────────────────────────
-- 4) propiedad_documento (R4)
-- ───────────────────────────────────────────────────────────────────────────
--
-- El binario nunca vive aquí: `clave_storage` apunta al objeto en MinIO y
-- `hash_sha256` es el SHA-256 del binario (R21). `tipo_documento` es texto
-- libre: el PRD no define taxonomía y no se inventa una.

CREATE TABLE IF NOT EXISTS "propiedad_documento" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "propiedad_id" uuid NOT NULL REFERENCES "propiedad"("id"),
  "nombre" text NOT NULL,
  "tipo_documento" text,
  "clave_storage" text NOT NULL,
  "hash_sha256" text NOT NULL,
  "mime" text,
  "tamano_bytes" bigint,
  "subido_por" uuid REFERENCES "user"("id"),
  "activo" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "propiedad_documento_clave_storage_key"
  ON "propiedad_documento" ("clave_storage");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "propiedad_documento_tenant_propiedad_idx"
  ON "propiedad_documento" ("tenant_id", "propiedad_id");
--> statement-breakpoint

-- ───────────────────────────────────────────────────────────────────────────
-- 5) RLS en las cuatro tablas (R1, R2, R3, R4)
-- ───────────────────────────────────────────────────────────────────────────
--
-- ENABLE + FORCE + política por tenant_id, en esta misma migración
-- (docs/conventions.md). Sin `WITH CHECK` propio: la política `USING` cubre
-- también el INSERT (el único tenant insertable es el del contexto).

ALTER TABLE "propiedad" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "propiedad" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "propiedad_propietario" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "propiedad_propietario" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "historial_ocupacion" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "historial_ocupacion" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "propiedad_documento" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "propiedad_documento" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'propiedad_tenant_isolation' AND tablename = 'propiedad'
  ) THEN
    CREATE POLICY "propiedad_tenant_isolation" ON "propiedad"
      USING ("tenant_id" = current_setting('app.current_tenant', true)::uuid);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'propiedad_propietario_tenant_isolation'
      AND tablename = 'propiedad_propietario'
  ) THEN
    CREATE POLICY "propiedad_propietario_tenant_isolation" ON "propiedad_propietario"
      USING ("tenant_id" = current_setting('app.current_tenant', true)::uuid);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'historial_ocupacion_tenant_isolation'
      AND tablename = 'historial_ocupacion'
  ) THEN
    CREATE POLICY "historial_ocupacion_tenant_isolation" ON "historial_ocupacion"
      USING ("tenant_id" = current_setting('app.current_tenant', true)::uuid);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'propiedad_documento_tenant_isolation'
      AND tablename = 'propiedad_documento'
  ) THEN
    CREATE POLICY "propiedad_documento_tenant_isolation" ON "propiedad_documento"
      USING ("tenant_id" = current_setting('app.current_tenant', true)::uuid);
  END IF;
END $$;
--> statement-breakpoint
