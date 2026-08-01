-- 0015_inventory_templates — #11: plantillas de inmuebles (zonas e ítems,
-- §8.8, RF-I2/RF-I22/RF-I23). Cubre R1, R2, R3, R4 y R9.
--
-- POR QUÉ EXISTE. El PRD §8.8: «la plantilla es el molde; el inventario la
-- instancia rellena». Esta migración crea el molde y su catálogo base; la
-- materialización (RF-I24) es la feature #12.
--
-- QUÉ NO HACE:
--
--   * **No materializa inventarios** (RF-I24): es #12.
--   * **No inventa el catálogo de las plantillas no enumeradas**: el PRD
--     solo detalla APARTAMENTO (§8.8.5); las otras cinco se siembran sin
--     zonas (PA-11-2) y el tenant las completa al clonar.
--   * **No crea vías fuera del RLS**: el patrón de plantillas del sistema
--     es el mismo de `workflow_definicion` (0013, PA-11-1).
--
-- Forward-only e idempotente (`docs/conventions.md`).

-- ───────────────────────────────────────────────────────────────────────────
-- 1) Las tres tablas (R1, R2, R3)
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "plantilla_inmueble" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "tipo" text NOT NULL CHECK ("tipo" IN ('APARTAMENTO', 'CASA', 'LOCAL', 'OFICINA', 'BODEGA', 'PARQUEADERO')),
  "nombre" text NOT NULL,
  "origen" text NOT NULL CHECK ("origen" IN ('SISTEMA', 'TENANT')),
  "version" integer NOT NULL DEFAULT 1,
  "activo" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "plantilla_inmueble_tenant_tipo_key"
  ON "plantilla_inmueble" ("tenant_id", "tipo");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "plantilla_zona" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "plantilla_id" uuid NOT NULL REFERENCES "plantilla_inmueble"("id"),
  "nombre" text NOT NULL,
  "repetible" boolean NOT NULL DEFAULT false,
  "obligatoria" boolean NOT NULL DEFAULT false,
  "orden" integer NOT NULL DEFAULT 0,
  "activo" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "plantilla_zona_plantilla_nombre_key"
  ON "plantilla_zona" ("plantilla_id", "nombre");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plantilla_zona_plantilla_idx"
  ON "plantilla_zona" ("plantilla_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "plantilla_item" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "zona_id" uuid NOT NULL REFERENCES "plantilla_zona"("id"),
  "nombre" text NOT NULL,
  "field_type" text NOT NULL CHECK ("field_type" IN ('estado', 'si_no', 'si_no_estado', 'conteo', 'seleccion', 'texto')),
  "opciones_json" jsonb,
  "obligatorio" boolean NOT NULL DEFAULT false,
  "foto_obligatoria" boolean NOT NULL DEFAULT false,
  "orden" integer NOT NULL DEFAULT 0,
  "activo" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "plantilla_item_zona_nombre_key"
  ON "plantilla_item" ("zona_id", "nombre");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plantilla_item_zona_idx"
  ON "plantilla_item" ("zona_id");
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'plantilla_item_opciones_check'
  ) THEN
    ALTER TABLE "plantilla_item" ADD CONSTRAINT "plantilla_item_opciones_check"
      CHECK (("field_type" = 'seleccion') = ("opciones_json" IS NOT NULL));
  END IF;
END $$;
--> statement-breakpoint

-- ───────────────────────────────────────────────────────────────────────────
-- 2) RLS (R1, R2, R3, PA-11-1)
-- ───────────────────────────────────────────────────────────────────────────
--
-- `plantilla_inmueble`: USING con OR del sistema (solo con contexto
-- presente) y WITH CHECK propio. `plantilla_zona`/`plantilla_item`: por
-- subconsulta a la plantilla (propia o del sistema) con WITH CHECK que solo
-- admite plantillas del contexto (nadie INSERTA filas del sistema).

ALTER TABLE "plantilla_inmueble" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "plantilla_inmueble" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "plantilla_zona" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "plantilla_zona" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "plantilla_item" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "plantilla_item" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'plantilla_inmueble_tenant_isolation'
      AND tablename = 'plantilla_inmueble'
  ) THEN
    CREATE POLICY "plantilla_inmueble_tenant_isolation" ON "plantilla_inmueble"
      USING ("tenant_id" = current_setting('app.current_tenant', true)::uuid
          OR ("tenant_id" = '00000000-0000-0000-0000-000000000000'::uuid
              AND current_setting('app.current_tenant', true) IS NOT NULL))
      WITH CHECK ("tenant_id" = current_setting('app.current_tenant', true)::uuid);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'plantilla_zona_tenant_isolation'
      AND tablename = 'plantilla_zona'
  ) THEN
    CREATE POLICY "plantilla_zona_tenant_isolation" ON "plantilla_zona"
      USING ("plantilla_id" IN (
        SELECT p.id FROM "plantilla_inmueble" p
         WHERE p."tenant_id" = current_setting('app.current_tenant', true)::uuid
            OR (p."tenant_id" = '00000000-0000-0000-0000-000000000000'::uuid
                AND current_setting('app.current_tenant', true) IS NOT NULL)
      ))
      WITH CHECK ("plantilla_id" IN (
        SELECT p.id FROM "plantilla_inmueble" p
         WHERE p."tenant_id" = current_setting('app.current_tenant', true)::uuid
      ));
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'plantilla_item_tenant_isolation'
      AND tablename = 'plantilla_item'
  ) THEN
    CREATE POLICY "plantilla_item_tenant_isolation" ON "plantilla_item"
      USING ("zona_id" IN (
        SELECT z.id FROM "plantilla_zona" z
         JOIN "plantilla_inmueble" p ON p.id = z."plantilla_id"
         WHERE p."tenant_id" = current_setting('app.current_tenant', true)::uuid
            OR (p."tenant_id" = '00000000-0000-0000-0000-000000000000'::uuid
                AND current_setting('app.current_tenant', true) IS NOT NULL)
      ))
      WITH CHECK ("zona_id" IN (
        SELECT z.id FROM "plantilla_zona" z
         JOIN "plantilla_inmueble" p ON p.id = z."plantilla_id"
         WHERE p."tenant_id" = current_setting('app.current_tenant', true)::uuid
      ));
  END IF;
END $$;
--> statement-breakpoint

-- ───────────────────────────────────────────────────────────────────────────
-- 3) Seed del catálogo base (R4, PA-11-2)
-- ───────────────────────────────────────────────────────────────────────────
--
-- APARTAMENTO con el ejemplo completo del PRD §8.8.5. Las otras cinco se
-- siembran sin zonas. Idempotente: solo si el tipo no existe.

DO $$
DECLARE
  v_apart uuid;
  v_zona uuid;
BEGIN
  -- Las seis plantillas base.
  INSERT INTO "plantilla_inmueble" (tenant_id, tipo, nombre, origen)
  SELECT '00000000-0000-0000-0000-000000000000', tipo, nombre, 'SISTEMA'
    FROM (VALUES
      ('APARTAMENTO',  'Apartamento'),
      ('CASA',         'Casa'),
      ('LOCAL',        'Local comercial'),
      ('OFICINA',      'Oficina'),
      ('BODEGA',       'Bodega'),
      ('PARQUEADERO',  'Parqueadero / Garaje')
    ) AS cat(tipo, nombre)
   WHERE NOT EXISTS (
     SELECT 1 FROM "plantilla_inmueble" p
      WHERE p."tenant_id" = '00000000-0000-0000-0000-000000000000'
        AND p."tipo" = cat.tipo
   );

  -- El detalle de APARTAMENTO (§8.8.5) si aún no tiene zonas.
  SELECT id INTO v_apart FROM "plantilla_inmueble"
   WHERE tenant_id = '00000000-0000-0000-0000-000000000000'
     AND tipo = 'APARTAMENTO';

  IF v_apart IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "plantilla_zona" WHERE "plantilla_id" = v_apart
  ) THEN
    INSERT INTO "plantilla_zona" (plantilla_id, nombre, repetible, obligatoria, orden)
    VALUES
      (v_apart, 'Sala',             false, true,  10),
      (v_apart, 'Cocina',           false, true,  20),
      (v_apart, 'Habitación',       true,  false, 30),
      (v_apart, 'Baño',             true,  false, 40),
      (v_apart, 'Entrega de llaves', false, true,  50);

    -- Sala
    SELECT id INTO v_zona FROM "plantilla_zona"
      WHERE plantilla_id = v_apart AND nombre = 'Sala';
    INSERT INTO "plantilla_item" (zona_id, nombre, field_type, obligatorio, foto_obligatoria, orden)
    VALUES
      (v_zona, 'Paredes', 'estado', true, false, 10),
      (v_zona, 'Piso', 'estado', true, false, 20),
      (v_zona, 'Techo', 'estado', true, false, 30),
      (v_zona, 'Ventanas', 'si_no_estado', true, false, 40),
      (v_zona, 'Iluminación', 'conteo', false, false, 50);

    -- Cocina
    SELECT id INTO v_zona FROM "plantilla_zona"
      WHERE plantilla_id = v_apart AND nombre = 'Cocina';
    INSERT INTO "plantilla_item" (zona_id, nombre, field_type, obligatorio, foto_obligatoria, orden)
    VALUES
      (v_zona, 'Mesón', 'estado', true, false, 10),
      (v_zona, 'Estufa', 'si_no_estado', true, true, 20),
      (v_zona, 'Lavaplatos', 'estado', true, false, 30),
      (v_zona, 'Electrodomésticos', 'texto', false, false, 40);

    -- Habitación (repetible)
    SELECT id INTO v_zona FROM "plantilla_zona"
      WHERE plantilla_id = v_apart AND nombre = 'Habitación';
    INSERT INTO "plantilla_item" (zona_id, nombre, field_type, obligatorio, foto_obligatoria, orden)
    VALUES
      (v_zona, 'Paredes', 'estado', true, false, 10),
      (v_zona, 'Clóset', 'si_no_estado', false, false, 20),
      (v_zona, 'Piso', 'estado', true, false, 30);

    -- Baño (repetible)
    SELECT id INTO v_zona FROM "plantilla_zona"
      WHERE plantilla_id = v_apart AND nombre = 'Baño';
    INSERT INTO "plantilla_item" (zona_id, nombre, field_type, obligatorio, foto_obligatoria, orden)
    VALUES
      (v_zona, 'Sanitario', 'estado', true, false, 10),
      (v_zona, 'Ducha/Regadera', 'estado', true, false, 20),
      (v_zona, 'Grifería', 'estado', true, false, 30);

    -- Entrega de llaves
    SELECT id INTO v_zona FROM "plantilla_zona"
      WHERE plantilla_id = v_apart AND nombre = 'Entrega de llaves';
    INSERT INTO "plantilla_item" (zona_id, nombre, field_type, obligatorio, foto_obligatoria, orden)
    VALUES
      (v_zona, 'Llaves puerta principal', 'conteo', true, false, 10),
      (v_zona, 'Control(es) parqueadero', 'conteo', false, false, 20),
      (v_zona, 'Tarjeta(s) acceso', 'conteo', false, false, 30);
  END IF;
END $$;
--> statement-breakpoint

COMMENT ON COLUMN "plantilla_inmueble"."origen" IS
  'R1/#11: SISTEMA = catalogo base del tenant reservado 00000000-...-0000 (solo lectura por API, R6); TENANT = copia clonada y editable por el admin (RF-I22, R5).';
