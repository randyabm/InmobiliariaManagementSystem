-- 0013_workflow_engine — #7: motor de workflows dirigido por datos (RF-W1..W5,
-- RF-A4, D3). Cubre R1, R2, R6, R10, R12, R13 y R17.
--
-- POR QUÉ EXISTE. RF-A4: el motor es genérico y reutilizable entre módulos
-- (inventarios, contratos, cobranza, mantenimiento, §5 del PRD). La primera
-- máquina real es el ciclo de vida de la propiedad (RF-P4): esta migración
-- la SIEMBRA COMO DATOS (R17), demostrando que una máquina completa vive en
-- filas, no en código.
--
-- QUÉ NO HACE:
--
--   * **No ejecuta notificaciones** (RF-W3): el hook `notificacion` de las
--     transiciones es dato; quien las envía es la feature #10.
--   * **No valida entidades** (p. ej. que `propiedad_id` exista): es del
--     módulo de negocio (#8); el motor trata `entidad_tipo`/`entidad_id`
--     como opacos (R12).
--   * **No limita por paquete ni versiona paquetes** (RF-W2 completo,
--     RF-A5): es la feature de paquetes del tenant.
--
-- Forward-only e idempotente (`docs/conventions.md`).

-- ───────────────────────────────────────────────────────────────────────────
-- 0) El tenant reservado del sistema (PA-7-1, R13)
-- ───────────────────────────────────────────────────────────────────────────
--
-- Las plantillas del sistema viven en la MISMA tabla con este tenant
-- reservado; la FK de `workflow_definicion.tenant_id` exige que exista.
-- Es un tenant NO comercial: sin paquetes ni código público. `nit` y
-- `codigo` son literales reservados que ningún alta real puede usar (el
-- CHECK de codigo rechaza el prefijo reservado `www`… pero no este valor,
-- así que la UNIQUE es la barrera).

INSERT INTO "tenant" (id, nombre, nit, codigo)
VALUES ('00000000-0000-0000-0000-000000000000', 'Sistema', '000000000', 'sistema')
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint

-- ───────────────────────────────────────────────────────────────────────────
-- 1) Las cinco tablas (R1, R2, R6, R12)
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "workflow_definicion" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "nombre" text NOT NULL,
  "tipo" text NOT NULL,
  "origen" text NOT NULL CHECK ("origen" IN ('SISTEMA', 'TENANT')),
  "version" integer NOT NULL DEFAULT 1,
  "activo" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_definicion_tenant_tipo_key"
  ON "workflow_definicion" ("tenant_id", "tipo");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "workflow_estado" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "definicion_id" uuid NOT NULL REFERENCES "workflow_definicion"("id"),
  "clave" text NOT NULL,
  "etiqueta" text NOT NULL,
  "es_inicial" boolean NOT NULL DEFAULT false,
  "es_final" boolean NOT NULL DEFAULT false,
  "orden" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_estado_definicion_clave_key"
  ON "workflow_estado" ("definicion_id", "clave");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_estado_definicion_idx"
  ON "workflow_estado" ("definicion_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "workflow_transicion" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "definicion_id" uuid NOT NULL REFERENCES "workflow_definicion"("id"),
  "origen_estado_id" uuid NOT NULL REFERENCES "workflow_estado"("id"),
  "destino_estado_id" uuid NOT NULL REFERENCES "workflow_estado"("id"),
  "clave" text NOT NULL,
  "tipo_ejecucion" text NOT NULL CHECK ("tipo_ejecucion" IN ('HUMANA', 'AUTOMATICA')),
  "roles_requeridos" text[] NOT NULL DEFAULT '{}',
  "condicion" jsonb NOT NULL DEFAULT '[]',
  "notificacion" jsonb NOT NULL DEFAULT '{}',
  "orden" integer NOT NULL DEFAULT 0,
  "activo" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_transicion_definicion_origen_clave_key"
  ON "workflow_transicion" ("definicion_id", "origen_estado_id", "clave");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_transicion_origen_idx"
  ON "workflow_transicion" ("definicion_id", "origen_estado_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "workflow_instancia" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "definicion_id" uuid NOT NULL REFERENCES "workflow_definicion"("id"),
  "entidad_tipo" text NOT NULL,
  "entidad_id" uuid NOT NULL,
  "estado_actual_id" uuid NOT NULL REFERENCES "workflow_estado"("id"),
  "contexto" jsonb NOT NULL DEFAULT '{}',
  "activo" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_instancia_definicion_entidad_key"
  ON "workflow_instancia" ("definicion_id", "entidad_tipo", "entidad_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_instancia_tenant_idx"
  ON "workflow_instancia" ("tenant_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "workflow_transicion_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "instancia_id" uuid NOT NULL REFERENCES "workflow_instancia"("id"),
  "transicion_id" uuid REFERENCES "workflow_transicion"("id"),
  "desde_estado_id" uuid NOT NULL REFERENCES "workflow_estado"("id"),
  "hacia_estado_id" uuid NOT NULL REFERENCES "workflow_estado"("id"),
  "actor_id" uuid,
  "automatica" boolean NOT NULL DEFAULT false,
  "contexto_tras" jsonb NOT NULL DEFAULT '{}',
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_log_instancia_idx"
  ON "workflow_transicion_log" ("instancia_id", "created_at");
--> statement-breakpoint

-- ───────────────────────────────────────────────────────────────────────────
-- 2) RLS en las cinco tablas (R13, R14)
-- ───────────────────────────────────────────────────────────────────────────
--
-- `workflow_definicion` tiene la política ESPECIAL de PA-7-1: USING con OR
-- (los tenants leen las plantillas del sistema) y WITH CHECK propio (nadie
-- INSERTA filas del sistema desde un contexto de tenant). El resto, la
-- política estándar.

ALTER TABLE "workflow_definicion" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "workflow_definicion" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "workflow_estado" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "workflow_estado" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "workflow_transicion" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "workflow_transicion" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "workflow_instancia" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "workflow_instancia" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "workflow_transicion_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "workflow_transicion_log" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'workflow_definicion_tenant_isolation'
      AND tablename = 'workflow_definicion'
  ) THEN
    CREATE POLICY "workflow_definicion_tenant_isolation" ON "workflow_definicion"
      USING ("tenant_id" = current_setting('app.current_tenant', true)::uuid
          OR "tenant_id" = '00000000-0000-0000-0000-000000000000'::uuid)
      WITH CHECK ("tenant_id" = current_setting('app.current_tenant', true)::uuid);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'workflow_estado_tenant_isolation'
      AND tablename = 'workflow_estado'
  ) THEN
    CREATE POLICY "workflow_estado_tenant_isolation" ON "workflow_estado"
      USING ("definicion_id" IN (
        SELECT d.id FROM "workflow_definicion" d
         WHERE d."tenant_id" = current_setting('app.current_tenant', true)::uuid
            OR d."tenant_id" = '00000000-0000-0000-0000-000000000000'::uuid
      ))
      WITH CHECK ("definicion_id" IN (
        SELECT d.id FROM "workflow_definicion" d
         WHERE d."tenant_id" = current_setting('app.current_tenant', true)::uuid
      ));
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'workflow_transicion_tenant_isolation'
      AND tablename = 'workflow_transicion'
  ) THEN
    CREATE POLICY "workflow_transicion_tenant_isolation" ON "workflow_transicion"
      USING ("definicion_id" IN (
        SELECT d.id FROM "workflow_definicion" d
         WHERE d."tenant_id" = current_setting('app.current_tenant', true)::uuid
            OR d."tenant_id" = '00000000-0000-0000-0000-000000000000'::uuid
      ))
      WITH CHECK ("definicion_id" IN (
        SELECT d.id FROM "workflow_definicion" d
         WHERE d."tenant_id" = current_setting('app.current_tenant', true)::uuid
      ));
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'workflow_instancia_tenant_isolation'
      AND tablename = 'workflow_instancia'
  ) THEN
    CREATE POLICY "workflow_instancia_tenant_isolation" ON "workflow_instancia"
      USING ("tenant_id" = current_setting('app.current_tenant', true)::uuid);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'workflow_transicion_log_tenant_isolation'
      AND tablename = 'workflow_transicion_log'
  ) THEN
    CREATE POLICY "workflow_transicion_log_tenant_isolation" ON "workflow_transicion_log"
      USING ("tenant_id" = current_setting('app.current_tenant', true)::uuid);
  END IF;
END $$;
--> statement-breakpoint

-- ───────────────────────────────────────────────────────────────────────────
-- 3) Log append-only (R10)
-- ───────────────────────────────────────────────────────────────────────────
--
-- Mismo patrón que `audit_log` (0006): la inmutabilidad la impone el motor,
-- no la disciplina del servicio.

CREATE OR REPLACE FUNCTION workflow_log_prevent_mutation()
RETURNS TRIGGER AS $fn$
BEGIN
  RAISE EXCEPTION 'workflow_transicion_log es append-only: no se permiten UPDATE ni DELETE';
  RETURN NULL;
END;
$fn$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_wf_log_no_update ON "workflow_transicion_log";
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_wf_log_no_delete ON "workflow_transicion_log";
--> statement-breakpoint
CREATE TRIGGER trg_wf_log_no_update
  BEFORE UPDATE ON "workflow_transicion_log"
  FOR EACH ROW EXECUTE FUNCTION workflow_log_prevent_mutation();
--> statement-breakpoint
CREATE TRIGGER trg_wf_log_no_delete
  BEFORE DELETE ON "workflow_transicion_log"
  FOR EACH ROW EXECUTE FUNCTION workflow_log_prevent_mutation();
--> statement-breakpoint

-- ───────────────────────────────────────────────────────────────────────────
-- 4) Seed: ciclo_vida_propiedad (R17, RF-P4)
-- ───────────────────────────────────────────────────────────────────────────
--
-- La máquina del RF-P4 como DATOS. La rama `en_desocupacion` demuestra
-- condiciones como datos (§12.2 «vuelve a checkeo»): con `entrega_ok =
-- true` va a `disponible`; en cualquier otro caso, a `en_checkeo`.
--
-- Idempotente: solo siembra si el tipo no existe (el tenant reservado nunca
-- se edita por API — R5).

DO $$
DECLARE
  v_def uuid;
  v_dis uuid; v_check uuid; v_aseg uuid; v_arr uuid;
  v_des uuid; v_inac uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "workflow_definicion" WHERE "tipo" = 'ciclo_vida_propiedad'
  ) THEN
    INSERT INTO "workflow_definicion"
      (tenant_id, nombre, tipo, origen, version)
    VALUES ('00000000-0000-0000-0000-000000000000',
            'Ciclo de vida de la propiedad', 'ciclo_vida_propiedad',
            'SISTEMA', 1)
    RETURNING id INTO v_def;

    INSERT INTO "workflow_estado"
      (definicion_id, clave, etiqueta, es_inicial, es_final, orden)
    VALUES
      (v_def, 'disponible',      'Disponible / Vacante',        true,  false, 10),
      (v_def, 'en_checkeo',      'En checkeo / estudio',        false, false, 20),
      (v_def, 'con_aseguradora', 'Con aseguradora / afianzadora', false, false, 30),
      (v_def, 'arrendada',       'Arrendada',                   false, true,  40),
      (v_def, 'en_desocupacion', 'En desocupación',             false, false, 50),
      (v_def, 'inactiva',        'Inactiva / Retirada',         false, true,  60);

    SELECT id INTO v_dis FROM "workflow_estado"
      WHERE definicion_id = v_def AND clave = 'disponible';
    SELECT id INTO v_check FROM "workflow_estado"
      WHERE definicion_id = v_def AND clave = 'en_checkeo';
    SELECT id INTO v_aseg FROM "workflow_estado"
      WHERE definicion_id = v_def AND clave = 'con_aseguradora';
    SELECT id INTO v_arr FROM "workflow_estado"
      WHERE definicion_id = v_def AND clave = 'arrendada';
    SELECT id INTO v_des FROM "workflow_estado"
      WHERE definicion_id = v_def AND clave = 'en_desocupacion';
    SELECT id INTO v_inac FROM "workflow_estado"
      WHERE definicion_id = v_def AND clave = 'inactiva';

    INSERT INTO "workflow_transicion"
      (definicion_id, origen_estado_id, destino_estado_id, clave,
       tipo_ejecucion, roles_requeridos, condicion, orden)
    VALUES
      (v_def, v_dis,   v_check, 'iniciar_checkeo',    'HUMANA', ARRAY['admin','empleado'], '[]', 10),
      (v_def, v_check, v_aseg,  'enviar_aseguradora', 'HUMANA', ARRAY['admin','empleado'], '[]', 20),
      (v_def, v_aseg,  v_arr,   'arrendar',           'HUMANA', ARRAY['admin','empleado'], '[]', 30),
      (v_def, v_arr,   v_des,   'iniciar_desocupacion','HUMANA', ARRAY['admin','empleado'], '[]', 40),
      (v_def, v_des,   v_dis,   'cerrar_entrega_ok',
       'HUMANA', ARRAY['admin','empleado'],
       '[{"campo":"entrega_ok","operador":"igual","valor":true}]', 50),
      (v_def, v_des,   v_check, 'reingresar_a_checkeo',
       'HUMANA', ARRAY['admin','empleado'],
       '[{"campo":"entrega_ok","operador":"distinto","valor":true}]', 51),
      (v_def, v_aseg,  v_dis,   'devolver_a_vacante', 'HUMANA', ARRAY['admin','empleado'], '[]', 60),
      (v_def, v_dis,   v_inac,  'retirar',            'HUMANA', ARRAY['admin','empleado'], '[]', 70);
  END IF;
END $$;
--> statement-breakpoint

COMMENT ON COLUMN "workflow_definicion"."origen" IS
  'R1/#7: SISTEMA = plantilla base del tenant reservado 00000000-...-0000 (solo lectura por API, R5); TENANT = copia clonada y editable por el admin (RF-W2, R4).';
