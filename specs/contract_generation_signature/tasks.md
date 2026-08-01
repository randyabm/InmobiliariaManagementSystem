# Tasks — contract_generation_signature

> Cobertura: R1–R7 en 18 tasks, 9 de test.

- [x] T1 — Tipos: `Contrato`, `FirmaContrato`, `ESTADOS_CONTRATO`.
- [x] T2 — Schemas `contract.ts` + `contrato-firma.ts`; exportar.
- [x] T3 — Migración `0020` (RLS, CHECKs, UNIQUE firma, append-only).
- [x] T4 — Journal, TABLAS +2, test RLS/append-only en migrations.db.
- [x] T5 — `contratos.repository.ts`: insertarContrato, buscarPorId,
  listar, buscarFirmas, insertarFirma.
- [x] T6 — `contratos.service.ts`: `generar` (R1: template validado →
  merge → PDF → propiedad_documento → anexo inventario CERRADO, R4),
  `firmarEmpleado`/`firmarInquilino` (R3/R5), `obtenerPdfFirmado` (R6).
- [x] T7 — Controller (7 rutas, @Audit) + módulo + RUTAS +7.
- [x] T8 — Unit del merge: {campo} sin valor → 400; valores reemplazados.
- [x] T9 — API: generar 201 (hash, contrato vigente, SELECT), template no
  validado → 409, inquilino ajeno → 404.
- [x] T10 — API: anexo del inventario CERRADO (RF-I12, SELECT
  propiedad_documento entidad=contrato).
- [x] T11 — API: firma empleado (201, evidencia), re-firma 409, hash ajeno
  409, estado → firmado con ambas (SELECT).
- [x] T12 — API: inquilino sin OTP FIRMA → 401; con OTP → 201 +
  otp_verificado_en (SELECT); inquilino ajeno → 404.
- [x] T13 — Seguridad: 404 cross-tenant en las 7 rutas, 403 roles, 401.
- [x] T14 — RLS real (3 tablas... contract+contrato_firma): SELECT sin
  WHERE, virgen → 0, INSERT ajeno rechazado, UPDATE firma rechazado
  (append-only).
- [x] T15 — Auditoría: mutaciones con entity_id y metadata vacío.
- [x] T16 — Integridad: GET pdf verifica el hash (R6).
- [x] T17 — Trazabilidad `progress/impl_contract_generation_signature.md`.
- [x] T18 — lint, typecheck, test, test:db, build, init.sh.

Review (mutaciones): merge sin validación de campos, UNIQUE firma, anexo
del inventario, estado firmado sin ambas partes.
