-- 0006_auditoria_append_only — inmutabilidad REAL de `audit_log` (R40, R41, R42).
--
-- Feature #5 `owner_tenant_profiles`, hallazgo B2 de
-- `progress/review_owner_tenant_profiles.md`. Requirements R40, R41 y R42 de
-- `specs/owner_tenant_profiles/requirements.md`.
--
-- QUÉ FALTABA. La cabecera de `0004_auditoria.sql` (línea 4) afirma:
--   "Append-only: trigger previene UPDATE y DELETE; RLS solo permite INSERT y
--    SELECT."
-- La segunda mitad es cierta; la primera NO lo era. `0004` habilita RLS y crea
-- las políticas de INSERT/SELECT, pero **nunca crea el trigger**: la frase
-- describía una intención, no el esquema. El único sitio donde ese trigger
-- existía era el `beforeAll` de `audit-log.test.ts`, que lo fabricaba justo
-- antes de afirmar que existía —verde por construcción— mientras en producción
-- `audit_log` era actualizable y borrable desde #4. Esta migración lo crea de
-- verdad; el test deja de crearlo y pasa a comprobarlo (R40, R57).
--
-- POR QUÉ NO SE EDITA `0004_auditoria.sql` (R42). `docs/conventions.md` prohíbe
-- editar una migración ya aplicada, y el migrador de Drizzle identifica cada
-- archivo por su hash: cambiar aunque sea un comentario de `0004` la convierte
-- en una migración distinta para el runner y rompe los entornos que ya la
-- aplicaron. La corrección de esa afirmación falsa vive por tanto aquí, en la
-- cabecera de la migración nueva. Es una desviación consciente de la
-- instrucción literal del reviewer, por una razón técnica
-- (`design.md` §17).
--
-- ALCANCE DEL TRIGGER (R41). Un trigger `BEFORE` se ejecuta para cualquier rol,
-- incluido el dueño de la tabla y el rol de migración: protege también contra
-- quien se salta el RLS, cosa que ninguna política puede hacer. Solo un
-- `ALTER TABLE ... DISABLE TRIGGER` (privilegio de dueño) lo desactiva, y eso
-- deja rastro en el esquema.
--
-- Forward-only e idempotente (`docs/conventions.md`): `CREATE OR REPLACE` para
-- la función y `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER` para cada trigger,
-- de modo que reaplicarla no falla. No hay archivo `down`: la auditoría no se
-- vuelve mutable "hacia atrás".

CREATE OR REPLACE FUNCTION audit_log_prevent_mutation()
RETURNS TRIGGER AS $fn$
BEGIN
  RAISE EXCEPTION 'audit_log es append-only: no se permiten UPDATE ni DELETE';
  RETURN NULL;
END;
$fn$ LANGUAGE plpgsql;
--> statement-breakpoint

COMMENT ON FUNCTION audit_log_prevent_mutation() IS
  'Aborta toda mutación de audit_log (R40, R41). La invocan los triggers trg_audit_log_no_update y trg_audit_log_no_delete.';
--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_audit_log_no_update ON "audit_log";
--> statement-breakpoint

CREATE TRIGGER trg_audit_log_no_update
  BEFORE UPDATE ON "audit_log"
  FOR EACH ROW
  EXECUTE FUNCTION audit_log_prevent_mutation();
--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_audit_log_no_delete ON "audit_log";
--> statement-breakpoint

CREATE TRIGGER trg_audit_log_no_delete
  BEFORE DELETE ON "audit_log"
  FOR EACH ROW
  EXECUTE FUNCTION audit_log_prevent_mutation();
