# Review — feature #14 (`inventory_signature_pdf`)

**Veredicto:** APPROVED

Revisor: agente `reviewer`. Fecha: 2026-08-01. HEAD revisado: `57a3062`.
Árbol de trabajo limpio después de la revisión.

Línea base ejecutada por el leader: `./init.sh` exit 0, `test` **821**,
`test:db` **143**, lint, typecheck y build verdes. Línea base de la
feature: **21/21 verdes** (API + seguridad + RLS real).

---

## 1. Verificación por mutación

| # | Mutación | Rojos | ¿Coincide con el informe? |
|---|---|---|---|
| 1 | Sin el chequeo de OTP de FIRMA reciente (R4) | **2 / 18** | ✅ («sin OTP → 401» y «con OTP → 201»: el flujo completo depende del gate) |
| 2 | Sin exigir el MISMO hash en ambas firmas | **0** | Inerte por diseño: `validarFirmable` exige el hash del ÚNICO documento (409 al regenerar); la comparación de hashes es defensa en profundidad — ver §2 |
| 3 | Sin el chequeo «hash coincide con el documento» | **0** | Inerte por ORDEN de tests: el 409 del hash ajeno lo cubre el UNIQUE (la parte ya firmó); la capa es defensa en profundidad — ver §2 |
| 4 | `confirmar-acuerdo` sin exigir revisión completa (R6) | **1 / 11** | ✅ («revisión incompleta → 409 sin cambiar») |
| 5 | Permitir regenerar el documento (R1) | **1 / 11** | ✅ («regenerar el mismo documento → 409»: un solo documento por inventario) |

Rojos concretos:

- **(1)** → el inquilino firmaba sin haber verificado ningún OTP de FIRMA.
- **(4)** → el acuerdo se confirmaba con la revisión incompleta.
- **(5)** → cada regeneración creaba un documento nuevo (hash distinto) y
  rompía «ambas partes firman el MISMO documento».

## 2. Mutaciones inertes explicadas (defensa en profundidad)

- **(2)** La comparación `empleado.hash === inquilino.hash` es alcanzable
  solo si ambos firmaron hashes distintos — imposible por la API, porque
  `validarFirmable` exige que el hash corresponda al ÚNICO documento del
  inventario (mut. 5 lo garantiza). Capa redundante correcta.
- **(3)** El chequeo «hash coincide con el documento» queda sombreado en
  los tests por el UNIQUE de una firma por parte (la segunda firma del
  empleado choca con 23505 antes de llegar a la validación). Se documenta
  como capa de defensa: en un orden distinto de operaciones (por ejemplo,
  un inquilino que intente firmar con un hash ajeno ANTES de que el
  empleado firme), es la única barrera.

## 3. Trazabilidad requirements ↔ tests (12/12)

Verificada archivo por archivo; la tabla del implementer
(`progress/impl_inventory_signature_pdf.md`) es fiel. R1–R12 [x], con
mutación que los sostiene en los puntos de riesgo (R4 → mut. 1, R6 → mut.
4, R1/R5 → mut. 5).

**Anclaje al PRD:** los 12 citan RF-I8, RF-I9, RF-I12 (frontera #17),
RF-AU3, §10.1 (Ley 527), D4, RF-C3, D2. Ningún requirement sin origen.

**Ningún test fabrica el objeto que dice verificar.** Las tablas y los
triggers los crea la migración 0018; el flujo completo (invitación →
revisión → acuerdo → PDF → firmas) pasa por la API real; las aserciones
usan `SELECT` independientes (`inventario_firma`, `propiedad_documento`,
`audit_log`, MinIO `getObject`); la inmutabilidad de la evidencia se
verifica contra el motor (UPDATE/DELETE del dueño rechazados).

## 4. Puntos críticos revisados

1. **Evidencia inmutable (R3, Ley 527).** `inventario_firma` con triggers
   append-only verificados incluso para el dueño (migrations.db); UNIQUE
   por parte (23505 → 409 `DOCUMENTO_NO_FIRMABLE`).
2. **R4 (OTP FIRMA).** Consume la infraestructura de #13 (R8): la firma del
   inquilino exige un OTP `FIRMA` verificado en los últimos 10 min; la
   evidencia registra `otp_verificado_en`. 401 uniforme sin OTP (mut. 1).
3. **R5 (mismo documento).** El hash estable del PDF (sin fechas
   automáticas en pdf-lib) + el 409 de regeneración (mut. 5) garantizan
   que ambas partes firmen el MISMO documento.
4. **R2/R7 (repositorio documental).** `propiedad_documento` ganó
   `entidad_tipo/entidad_id` (ALTER idempotente, PA-14-2); la descarga
   verifica el hash antes de responder (R11, T16).
5. **R6 (acuerdo).** Acepta `ENVIADO` (estado que produce #13) y
   `EN_REVISION` (frontera #22), siempre con revisión completa (mut. 4).

## 5. Tasks completas

**22 / 22 `[x]`** en `specs/inventory_signature_pdf/tasks.md`.

## 6. Invariantes de seguridad (C7)

- **Aislamiento por tenant:** [x] — RLS real (T17: SELECT sin WHERE, virgen
  → 0 filas, INSERT ajeno rechazado) + HTTP (T18: 404 en las 5 rutas,
  «nada se escribió» con SELECT, scoping del inquilino).
- **RBAC con test de rechazo:** [x] — T19: inquilino → 403 en rutas de
  empleado, empleado → 403 en la firma del inquilino, 401 sin token.
- **Auditoría de acciones críticas:** [x] — T20: PDF y firmas con
  `entity_id` y `metadata` vacío.
- **Sin secretos hardcodeados:** [x] — sin secretos nuevos.
- **Datos personales en logs:** [x] — T20: la IP vive en `inventario_firma`
  y no aparece en `audit_log`.
- **Integridad documental (SHA-256):** [x] — R11: hash expuesto en la
  descarga y verificado contra el binario real (T16).

## 7. Checkpoints

C1 [x] · C2 [x] · C3 [x] · C4 [x] · C5 [x] · C6 [x] · C7 [x] · C8 n/a

---

## Bloqueantes

**Ninguno.**

## Deuda anotada (no bloqueante)

- **D-1 —** El vínculo FORMAL contrato ↔ inventario firmado (RF-I12) lo
  añade #17; el documento ya está en el repositorio documental con su hash
  (PA-14-2).
- **D-2 —** `confirmar-acuerdo` acepta `ENVIADO` y `EN_REVISION`; cuando
  #22 introduzca `EN_NEGOCIACION → ACORDADO`, el acuerdo seguirá exigiendo
  la revisión completa — la frontera está anotada en el spec.
- **D-3 —** La mutación del OTP no cubre el caso «OTP verificado hace más
  de 10 minutos» (la ventana se probó con la ausencia total); el test de
  la ventana exacta queda para #22 si toca la firma.
- **D-4 —** El PDF se regenera con contenido estable, pero si las fotos en
  MinIO cambian entre generaciones el hash cambiaría; el 409 de
  regeneración lo impide en la práctica.

## Recomendación

**Cerrar #14 como `done`.** El ciclo del inventario del §8.7 queda cerrado:
borrador (#12) → invitación y revisión (#13) → acuerdo → PDF con hash
estable → firmas con evidencia inmutable y OTP (mut. 1, 4 y 5 rojas) →
CERRADO. #17 tiene el vínculo al contrato anotado.
