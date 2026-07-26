-- 0005_owner_tenant_profiles — hoja de vida de propietario e inquilino (núcleo).
--
-- Feature #5. Requirements R1..R7, R37 de specs/owner_tenant_profiles/.
-- Forward-only e idempotente (docs/conventions.md): no hay archivo `down` y
-- esta migración no se edita una vez aplicada.
--
-- Las tres tablas de negocio nuevas habilitan RLS (ENABLE + FORCE + política
-- por tenant_id) en ESTA MISMA migración: crear una tabla de negocio sin RLS
-- es un defecto aunque los tests pasen (docs/conventions.md, D2).

-- 1) D-5: un cliente (RF-C1) se registra sin credenciales de portal.
--    Contrapartida obligatoria en el código: POST /auth/login responde 401
--    si password_hash IS NULL, sin evaluar contraseña (R6).
ALTER TABLE "user" ALTER COLUMN "password_hash" DROP NOT NULL;
--> statement-breakpoint

-- 2) D-5: el email del propietario es opcional (R7).
--    La restricción UNIQUE existente se conserva SIN CAMBIOS: en PostgreSQL
--    UNIQUE trata cada NULL como distinto, así que varias identidades sin
--    email conviven y dos emails iguales no nulos siguen colisionando. No se
--    necesita índice parcial. Contrapartida obligatoria: R8.
ALTER TABLE "user" ALTER COLUMN "email" DROP NOT NULL;
--> statement-breakpoint

-- 3) Perfil del propietario (R1).
--    Sin columna de tarifa de retención: la tarifa la fija la ley y cambia por
--    año, así que es configuración del tenant y vive en la feature #25 (D-2).
--    `documento` es único DENTRO del tenant (D-7): una unicidad global
--    revelaría por colisión que la persona ya es cliente de otra inmobiliaria
--    (PRD §11.3).
CREATE TABLE IF NOT EXISTS "perfil_propietario" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "user_id" uuid NOT NULL REFERENCES "user"("id"),
  "tipo_documento" text NOT NULL,
  "documento" text NOT NULL,
  "direccion_notificacion" text,
  "ciudad" text,
  "sujeto_retencion" boolean NOT NULL DEFAULT false,
  "activo" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "perfil_propietario_tipo_documento_check"
    CHECK ("tipo_documento" IN ('CC', 'CE', 'NIT', 'PASAPORTE')),
  CONSTRAINT "perfil_propietario_tenant_user_key"
    UNIQUE ("tenant_id", "user_id"),
  CONSTRAINT "perfil_propietario_tenant_documento_key"
    UNIQUE ("tenant_id", "tipo_documento", "documento")
);
--> statement-breakpoint

-- 4) Perfil del inquilino (R2).
CREATE TABLE IF NOT EXISTS "perfil_inquilino" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "user_id" uuid NOT NULL REFERENCES "user"("id"),
  "tipo_documento" text NOT NULL,
  "documento" text NOT NULL,
  "celular" text NOT NULL,
  "medio_preferido_contacto" text NOT NULL,
  "activo" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "perfil_inquilino_tipo_documento_check"
    CHECK ("tipo_documento" IN ('CC', 'CE', 'NIT', 'PASAPORTE')),
  CONSTRAINT "perfil_inquilino_medio_contacto_check"
    CHECK ("medio_preferido_contacto" IN ('CORREO', 'SMS', 'WHATSAPP', 'LLAMADA')),
  CONSTRAINT "perfil_inquilino_tenant_user_key"
    UNIQUE ("tenant_id", "user_id"),
  CONSTRAINT "perfil_inquilino_tenant_documento_key"
    UNIQUE ("tenant_id", "tipo_documento", "documento")
);
--> statement-breakpoint

-- 5) Cuenta de giro del canon (R3).
CREATE TABLE IF NOT EXISTS "cuenta_bancaria" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenant"("id"),
  "perfil_propietario_id" uuid NOT NULL REFERENCES "perfil_propietario"("id"),
  "banco" text NOT NULL,
  "tipo_cuenta" text NOT NULL,
  "numero_cuenta" text NOT NULL,
  "titular_nombre" text NOT NULL,
  "titular_tipo_documento" text NOT NULL,
  "titular_documento" text NOT NULL,
  "es_predeterminada" boolean NOT NULL DEFAULT false,
  "activa" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "cuenta_bancaria_tipo_cuenta_check"
    CHECK ("tipo_cuenta" IN ('AHORROS', 'CORRIENTE')),
  CONSTRAINT "cuenta_bancaria_titular_tipo_documento_check"
    CHECK ("titular_tipo_documento" IN ('CC', 'CE', 'NIT', 'PASAPORTE'))
);
--> statement-breakpoint

-- 6) RLS en las tres tablas nuevas (R5, D2).
ALTER TABLE "perfil_propietario" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "perfil_propietario" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "perfil_inquilino" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "perfil_inquilino" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "cuenta_bancaria" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "cuenta_bancaria" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'perfil_propietario_tenant_isolation'
      AND tablename = 'perfil_propietario'
  ) THEN
    CREATE POLICY "perfil_propietario_tenant_isolation" ON "perfil_propietario"
      USING ("tenant_id" = current_setting('app.current_tenant', true)::uuid);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'perfil_inquilino_tenant_isolation'
      AND tablename = 'perfil_inquilino'
  ) THEN
    CREATE POLICY "perfil_inquilino_tenant_isolation" ON "perfil_inquilino"
      USING ("tenant_id" = current_setting('app.current_tenant', true)::uuid);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'cuenta_bancaria_tenant_isolation'
      AND tablename = 'cuenta_bancaria'
  ) THEN
    CREATE POLICY "cuenta_bancaria_tenant_isolation" ON "cuenta_bancaria"
      USING ("tenant_id" = current_setting('app.current_tenant', true)::uuid);
  END IF;
END $$;
--> statement-breakpoint

-- 7) Una sola cuenta predeterminada activa por propietario (R4).
--    Lo fuerza la base de datos, no el código: un olvido en un `UPDATE` no
--    puede dejar dos cuentas de giro compitiendo.
CREATE UNIQUE INDEX IF NOT EXISTS "cuenta_bancaria_predeterminada_key"
  ON "cuenta_bancaria" ("perfil_propietario_id")
  WHERE "es_predeterminada" AND "activa";
--> statement-breakpoint

-- 8) Índices de consulta.
CREATE INDEX IF NOT EXISTS "perfil_propietario_tenant_documento_idx"
  ON "perfil_propietario" ("tenant_id", "documento");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "perfil_inquilino_tenant_documento_idx"
  ON "perfil_inquilino" ("tenant_id", "documento");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cuenta_bancaria_tenant_propietario_idx"
  ON "cuenta_bancaria" ("tenant_id", "perfil_propietario_id");
