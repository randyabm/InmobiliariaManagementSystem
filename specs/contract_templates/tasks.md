# Tasks — contract_templates

> Cobertura: R1–R6 en 14 tasks (T1–T14), 6 de test.

- [x] T1 — Tipos `packages/types/src/contratos.ts`: `ContractTemplate`,
  `MergeFields`, `EstadoPlantillaContrato`; exportar.
- [x] T2 — Schema Drizzle `contract-template.ts` + exportar.
- [x] T3 — Migración `0019_contract_templates.sql` (RLS ENABLE+FORCE,
  UNIQUEs, CHECK estado).
- [x] T4 — `_journal.json`, `TABLAS_PERMITIDAS` +1, test en
  `migrations.db.test.ts` (tabla + RLS + UNIQUEs).
- [x] T5 — `plantillas-contrato.repository.ts`: buscarBase, insertarBase,
  actualizar, validar, buscarPorPropiedad, insertarCopia (misma tx).
- [x] T6 — `plantillas-contrato.service.ts`: `obtenerBase` (404 si no),
  `crearBase` (409 duplicada), `editarBase` (PA-16-2: validar merge
  fields; version++ si validada), `validarBase` (admin), `proponerPara
  Propiedad` (R3: copia + campos de la propiedad pre-rellenos, 409
  duplicada), `validarDePropiedad` (R4: admin).
- [x] T7 — Controller (7 rutas) + `@Audit` en mutaciones.
- [x] T8 — Registrar módulo + `RUTAS_PERMITIDAS` (+7).
- [x] T9 — Unit: validación de merge fields (PA-16-2): `{campo}` sin
  definición → 400; cuerpo sin `{}` → válido.
- [x] T10 — API: crear base 201 → 409; editar con version++ tras validar;
  validar solo admin (403 empleado).
- [x] T11 — API: proponer borrador de propiedad (201, campos pre-rellenos
  en SELECT), repetir → 409, validar copia (admin).
- [x] T12 — Seguridad: 404 de otro tenant (base y copia), 403 roles, 401
  sin token.
- [x] T13 — Auditoría: validaciones en `audit_log` con metadata vacío.
- [x] T14 — Verificación: lint, typecheck, test, test:db, build, init.sh.

Tasks de review: mutaciones — 409 de base duplicada, validación de merge
fields, UNIQUEs del motor.
