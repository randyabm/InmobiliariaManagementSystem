-- 0010_retencion_codeudor_referencias — #25: tarifa de retención por tenant y
-- año (D-2) y codeudores / coarrendatarios / referencias del inquilino (D-6).
-- Cubre R1, R2, R3, R4 y R5.
--
-- POR QUÉ EXISTE. El spec de la #5 partió esta feature: el núcleo (perfiles,
-- identidad, cuenta bancaria) quedó en #5, y la tarifa de retención (la fija
-- la ley, cambia por año → configuración del tenant, D-2) y los codeudores y
-- referencias del inquilino (captura de datos de la hoja de vida, D-6) quedan
-- aquí.
--
-- QUÉ NO HACE:
--
--   * **No añade ninguna columna a `perfil_propietario`** (R5): la tarifa vive
--     únicamente en `tarifa_retencion`. `sujeto_retencion` (quién aplica) ya
--     está en el perfil desde `0005`; la tarifa (cuánto aplica) vive aquí.
--   * **No declara ninguna FK hacia contrato, firma, inventario u OTP** (R18):
--     codeudor y referencia son captura de datos; el amarre a la firma lo
--     añadirán #14/#17 desde la tabla de firmas.
--   * **No calcula dinero**: solo persiste el porcentaje que el módulo de
--     pagos aplicará después (design.md §6).
--   * **No crea identidades**: un codeudor y una referencia no son usuarios
--     del sistema, no se les crea `user` ni `user_role` (design.md §9).
--
-- Forward-only e idempotente (`docs/conventions.md`).

-- ───────────────────────────────────────────────────────────────────────────
-- 1) tarifa_retencion (R1, D-2)
-- ───────────────────────────────────────────────────────────────────────────
--
-- `porcentaje` es `numeric(5,2)`, nunca float (docs/conventions.md): un valor
-- con consecuencias fiscales no se transporta como `number` de JavaScript en
-- ninguna frontera (R11). El driver `pg` lo devuelve como cadena y así viaja.
--
-- UNIQUE (tenant_id, anio): una sola tarifa por año y por inmobiliaria. El
-- service la usa con upsert (R6) — no hay "historial de versiones" de la
-- tarifa, porque es la ley la que la cambia, no el tenant.

CREATE TABLE IF NOT EXISTS "tarifa_retencion" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "anio" integer NOT NULL,
  "porcentaje" numeric(5,2) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tarifa_retencion_tenant_anio_key"
  ON "tarifa_retencion" ("tenant_id", "anio");
--> statement-breakpoint

-- ───────────────────────────────────────────────────────────────────────────
-- 2) codeudor_inquilino (R2, D-6)
-- ───────────────────────────────────────────────────────────────────────────
--
-- La UNIQUE es (tenant_id, perfil_inquilino_id, tipo_documento, documento):
-- el mismo codeudor puede repetirse en dos inquilinos distintos (misma
-- persona acompañando a dos arrendatarios), pero no dentro del mismo
-- inquilino (R14). La unicidad es DENTRO del tenant (D-7): una unicidad
-- global permitiría descubrir por colisión que una persona ya figura en otra
-- inmobiliaria (§11.3).

CREATE TABLE IF NOT EXISTS "codeudor_inquilino" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "perfil_inquilino_id" uuid NOT NULL REFERENCES "perfil_inquilino"("id"),
  "tipo" text NOT NULL CHECK ("tipo" IN ('CODEUDOR', 'COARRENDATARIO')),
  "nombre" text NOT NULL,
  "tipo_documento" text NOT NULL CHECK ("tipo_documento" IN ('CC', 'CE', 'NIT', 'PASAPORTE')),
  "documento" text NOT NULL,
  "email" text,
  "celular" text,
  "activo" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "codeudor_inquilino_tenant_inquilino_documento_key"
  ON "codeudor_inquilino" ("tenant_id", "perfil_inquilino_id", "tipo_documento", "documento");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "codeudor_inquilino_tenant_inquilino_idx"
  ON "codeudor_inquilino" ("tenant_id", "perfil_inquilino_id");
--> statement-breakpoint

-- ───────────────────────────────────────────────────────────────────────────
-- 3) referencia_inquilino (R3, D-6)
-- ───────────────────────────────────────────────────────────────────────────
--
-- `relacion` es texto libre y nullable: el PRD no define una taxonomía de
-- referencias y no se inventa una.

CREATE TABLE IF NOT EXISTS "referencia_inquilino" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "perfil_inquilino_id" uuid NOT NULL REFERENCES "perfil_inquilino"("id"),
  "nombre" text NOT NULL,
  "telefono" text NOT NULL,
  "relacion" text,
  "email" text,
  "activo" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "referencia_inquilino_tenant_inquilino_idx"
  ON "referencia_inquilino" ("tenant_id", "perfil_inquilino_id");
--> statement-breakpoint

-- ───────────────────────────────────────────────────────────────────────────
-- 4) RLS en las tres tablas (R4, D2)
-- ───────────────────────────────────────────────────────────────────────────
--
-- ENABLE + FORCE + política por `tenant_id`, en ESTA MISMA migración que las
-- crea (docs/conventions.md). Sin `WITH CHECK` propio: la política es solo
-- `USING`, así que el INSERT también se filtra por ella — el único `tenant_id`
-- insertable es el del contexto de la conexión.
--
-- FORCE alcanza al dueño de la tabla: solo el superusuario (o un rol con
-- BYPASSRLS) puede ver fuera del contexto, y la aplicación corre con un rol
-- sin ese privilegio (R46, hallazgo B3 de la sesión anterior).

ALTER TABLE "tarifa_retencion" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tarifa_retencion" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "codeudor_inquilino" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "codeudor_inquilino" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "referencia_inquilino" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "referencia_inquilino" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'tarifa_retencion_tenant_isolation'
      AND tablename = 'tarifa_retencion'
  ) THEN
    CREATE POLICY "tarifa_retencion_tenant_isolation" ON "tarifa_retencion"
      USING ("tenant_id" = current_setting('app.current_tenant', true)::uuid);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'codeudor_inquilino_tenant_isolation'
      AND tablename = 'codeudor_inquilino'
  ) THEN
    CREATE POLICY "codeudor_inquilino_tenant_isolation" ON "codeudor_inquilino"
      USING ("tenant_id" = current_setting('app.current_tenant', true)::uuid);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'referencia_inquilino_tenant_isolation'
      AND tablename = 'referencia_inquilino'
  ) THEN
    CREATE POLICY "referencia_inquilino_tenant_isolation" ON "referencia_inquilino"
      USING ("tenant_id" = current_setting('app.current_tenant', true)::uuid);
  END IF;
END $$;
--> statement-breakpoint
