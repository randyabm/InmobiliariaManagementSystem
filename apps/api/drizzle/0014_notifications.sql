-- 0014_notifications — #10: motor de notificaciones asíncronas (RF-N1, RF-N2,
-- RF-W3). Cubre R1, R6 y R10.
--
-- POR QUÉ EXISTE. #7 dejó el hook `notificacion` como DATO en las
-- transiciones del workflow; esta migración crea el estado que #10 consume:
-- el outbox transaccional (la fila se escribe y revierte CON la transición,
-- PA-10-4), el registro inmutable de lo entregado y los recordatorios
-- programados (RF-N2).
--
-- QUÉ NO HACE:
--
--   * **No toca `workflow_transicion`**: el hook ya es dato de #7.
--   * **No introduce proveedores reales**: la interfaz y el ProveedorRegistro
--     viven en el código (PA-10-2).
--
-- Forward-only e idempotente (`docs/conventions.md`).

-- ───────────────────────────────────────────────────────────────────────────
-- 1) notificacion_pendiente (R1) — el outbox
-- ───────────────────────────────────────────────────────────────────────────
--
-- `contenido` guarda la intención (sustitución mínima de variables); el
-- destinatario final se resuelve al procesar (R7), no al encolar.

CREATE TABLE IF NOT EXISTS "notificacion_pendiente" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "canal" text,
  "destinatario" text,
  "plantilla" text,
  "contenido" jsonb NOT NULL DEFAULT '{}',
  "entidad_tipo" text,
  "entidad_id" uuid,
  "transicion_id" uuid,
  "estado" text NOT NULL DEFAULT 'PENDIENTE'
    CHECK ("estado" IN ('PENDIENTE', 'PROCESADA', 'FALLIDA')),
  "intentos" integer NOT NULL DEFAULT 0,
  "error" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "procesada_en" timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notificacion_pendiente_estado_idx"
  ON "notificacion_pendiente" ("estado", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notificacion_pendiente_tenant_idx"
  ON "notificacion_pendiente" ("tenant_id");
--> statement-breakpoint

-- ───────────────────────────────────────────────────────────────────────────
-- 2) notificacion_enviada (R6) — registro append-only de lo entregado
-- ───────────────────────────────────────────────────────────────────────────
--
-- La historia de lo enviado es inmutable: los triggers impiden UPDATE y
-- DELETE (patrón `audit_log`, 0006).

CREATE TABLE IF NOT EXISTS "notificacion_enviada" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "canal" text NOT NULL,
  "destinatario" text NOT NULL,
  "entidad_tipo" text,
  "entidad_id" uuid,
  "plantilla" text,
  "contenido" jsonb NOT NULL DEFAULT '{}',
  "estado" text NOT NULL CHECK ("estado" IN ('PROCESADA', 'FALLIDA')),
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notificacion_enviada_tenant_created_idx"
  ON "notificacion_enviada" ("tenant_id", "created_at");
--> statement-breakpoint

CREATE OR REPLACE FUNCTION notificacion_enviada_prevent_mutation()
RETURNS TRIGGER AS $fn$
BEGIN
  RAISE EXCEPTION 'notificacion_enviada es append-only: no se permiten UPDATE ni DELETE';
  RETURN NULL;
END;
$fn$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_notif_no_update ON "notificacion_enviada";
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_notif_no_delete ON "notificacion_enviada";
--> statement-breakpoint
CREATE TRIGGER trg_notif_no_update
  BEFORE UPDATE ON "notificacion_enviada"
  FOR EACH ROW EXECUTE FUNCTION notificacion_enviada_prevent_mutation();
--> statement-breakpoint
CREATE TRIGGER trg_notif_no_delete
  BEFORE DELETE ON "notificacion_enviada"
  FOR EACH ROW EXECUTE FUNCTION notificacion_enviada_prevent_mutation();
--> statement-breakpoint

-- ───────────────────────────────────────────────────────────────────────────
-- 3) notificacion_programada (R10) — recordatorios (RF-N2)
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "notificacion_programada" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "programada_para" timestamptz NOT NULL,
  "estado" text NOT NULL DEFAULT 'PENDIENTE'
    CHECK ("estado" IN ('PENDIENTE', 'EJECUTADA', 'CANCELADA')),
  "destinatario" text NOT NULL,
  "canal" text NOT NULL,
  "plantilla" text,
  "contenido" jsonb NOT NULL DEFAULT '{}',
  "entidad_tipo" text,
  "entidad_id" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "ejecutada_en" timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notificacion_programada_vencida_idx"
  ON "notificacion_programada" ("estado", "programada_para");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notificacion_programada_tenant_idx"
  ON "notificacion_programada" ("tenant_id");
--> statement-breakpoint

-- ───────────────────────────────────────────────────────────────────────────
-- 4) RLS en las tres tablas (R1, R6, R10)
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE "notificacion_pendiente" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "notificacion_pendiente" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "notificacion_enviada" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "notificacion_enviada" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "notificacion_programada" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "notificacion_programada" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'notificacion_pendiente_tenant_isolation'
      AND tablename = 'notificacion_pendiente'
  ) THEN
    CREATE POLICY "notificacion_pendiente_tenant_isolation" ON "notificacion_pendiente"
      USING ("tenant_id" = current_setting('app.current_tenant', true)::uuid);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'notificacion_enviada_tenant_isolation'
      AND tablename = 'notificacion_enviada'
  ) THEN
    CREATE POLICY "notificacion_enviada_tenant_isolation" ON "notificacion_enviada"
      USING ("tenant_id" = current_setting('app.current_tenant', true)::uuid);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'notificacion_programada_tenant_isolation'
      AND tablename = 'notificacion_programada'
  ) THEN
    CREATE POLICY "notificacion_programada_tenant_isolation" ON "notificacion_programada"
      USING ("tenant_id" = current_setting('app.current_tenant', true)::uuid);
  END IF;
END $$;
--> statement-breakpoint
