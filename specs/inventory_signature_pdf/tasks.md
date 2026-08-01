# Tasks — inventory_signature_pdf

> Feature #14. Pasos discretos en orden. Las tasks de test son de primera
> clase: los invariantes de seguridad (bloque 5) se verifican con asserts
> deterministas contra PostgreSQL y MinIO reales (Testcontainers).
>
> **Prerrequisitos:** #13, #12 y #6 `done` (el lote #12/#13/#15 + #14 se
> implementa en el mismo batch; esta feature depende de #13 para el OTP de
> FIRMA y de #6 para el repositorio documental).
>
> **PA-14 aprobadas en la puerta del spec:** PA-14-1 (pdf-lib MVP tras
> interfaz), PA-14-2 (PDF en propiedad_documento), PA-14-3 (acuerdo por
> confirmar-acuerdo), PA-14-4 (firma propia tras ServicioFirma).
>
> Cobertura: R1–R12 en 22 tasks (T1–T22), de las cuales 11 son tasks de test.

---

## Bloque 0 — Tipos y esquema

- [ ] T1 — Crear `packages/types/src/inventario-firma.ts` con
  `FirmanteTipo`, `FirmaInventario` y `EvidenciaFirma`; exportar desde el
  index. **Cubre: R3.**

- [ ] T2 — Crear el esquema Drizzle `inventario-firma.ts` (append-only:
  el schema no lleva UPDATE/DELETE; los triggers van en la migración) y
  exportarlo en `schema/index.ts`. **Cubre: R3, R12.**

## Bloque 1 — Migración

- [ ] T3 — Escribir `0018_inventory_signature_pdf.sql`: `inventario_firma`
  con RLS ENABLE+FORCE, CHECKs (firmante_tipo), UNIQUE
  (inventario_id, firmante_tipo) y los triggers append-only (función +
  `trg_firma_no_update`/`trg_firma_no_delete`). **Cubre: R3, R12.**

- [ ] T4 — `_journal.json`, `TABLAS_PERMITIDAS` +1 y test en
  `migrations.db.test.ts` (la tabla con RLS, la UNIQUE por parte y la
  inmutabilidad incluso para el dueño — UPDATE/DELETE rechazados). **Cubre:
  R3, R12.**

## Bloque 2 — PDF (R1, PA-14-1)

- [ ] T5 — Añadir `pdf-lib` a `apps/api/package.json` y crear la interfaz
  `generador-pdf.ts` + la implementación MVP (`pdf-lib`): cabecera,
  zonas/ítems con respuesta y comentario, fotos incrustadas (descargadas
  de MinIO vía `urlTemporal` de #6), y el hash SHA-256 del binario.
  **Cubre: R1, R11, PA-14-1.**

- [ ] T6 — Unit test del generador (pdf-lib real): el binario es un PDF
  válido (cabecera `%PDF`), el hash SHA-256 coincide con el del binario y
  las fotos incrustadas aparecen (números de XObject). **Cubre: R1, R11.**

- [ ] T7 — `firma-pdf.service.ts`: `generarPdf` (R1: exige el inventario,
  arma `PdfInventario`, delega en `GeneradorPdf`) y `obtenerPdfFirmado`
  (R7: lee `propiedad_documento` tipo `inventario_firmado`, descarga de
  MinIO y **verifica el hash antes de responder**, R11). **Cubre: R1, R7,
  R11.**

## Bloque 3 — Firma (R3, R4, R5, PA-14-4)

- [ ] T8 — Interfaz `servicio-firma.ts` + implementación MVP que registra
  la evidencia en `inventario_firma` (append-only). **Cubre: R3, PA-14-4.**

- [ ] T9 — `firma-pdf.service.ts`: `confirmarAcuerdo` (R6: exige
  `EN_REVISION` + `revision_completada_en`, 409 si no; transiciona a
  `ACORDADO`), `firmarEmpleado` (R3/R5: exige `ACORDADO`, registra la
  evidencia con IP/timestamp/hash; la segunda firma de la misma parte →
  409) y `firmarInquilino` (R4: scoping #13 + OTP `FIRMA` verificado en
  10 min, 401 si no). Ambas partes firmadas con el mismo hash →
  `FIRMADO` (R5). **Cubre: R3, R4, R5, R6.**

- [ ] T10 — `firma-pdf.controller.ts` con las 5 rutas del design §6,
  guards y `@Audit` en las mutaciones. **Cubre: R1, R3-R7, R8, R10.**

- [ ] T11 — `almacenarPdfFirmado` (R2): subir a MinIO, fila en
  `propiedad_documento` (`tipo_documento = 'inventario_firmado'`, hash) y
  transicionar a `CERRADO`. **Cubre: R2, R5.**

## Bloque 4 — Tests de integración

- [ ] T12 — PDF: generar sobre un inventario `EN_REVISION` con revisión
  completa → 200 con binario `%PDF` y hash correcto (SELECT del hash);
  el PDF incluye los ítems y sus fotos (XObjects). **Cubre: R1.**

- [ ] T13 — Acuerdo: confirmar-acuerdo con revisión incompleta → 409
  `ACUERDO_INCOMPLETO` sin cambiar; con revisión completa → `ACORDADO`
  (SELECT). **Cubre: R6.**

- [ ] T14 — Firma del empleado: 200 + fila en `inventario_firma` con
  evidencia (IP, timestamp, hash) (SELECT); repetir → 409; firmar en otro
  estado → 409. **Cubre: R3, R5.**

- [ ] T15 — Firma del inquilino: sin OTP FIRMA verificado → 401
  `FIRMA_SIN_OTP`; con OTP → 200 y la evidencia incluye
  `otp_verificado_en` (SELECT); con ambas firmas → `FIRMADO`. **Cubre:
  R4, R5.**

- [ ] T16 — Cierre: `almacenarPdfFirmado` → `CERRADO` (SELECT), fila en
  `propiedad_documento` con el hash (SELECT); `GET /inventarios/:id/pdf`
  devuelve el binario cuyo hash coincide con el registrado (R11).
  **Cubre: R2, R7, R11.**

## Bloque 5 — Invariantes de seguridad (tests deterministas, obligatorios)

- [ ] T17 — `apps/api/src/database/__tests__/firma-rls.test.ts`
  (Testcontainers, rol sin `BYPASSRLS`): `SELECT *` sin `WHERE` sobre
  `inventario_firma` devuelve solo filas del tenant; conexión virgen → 0
  filas. **Cubre: R8, R9.**

- [ ] T18 — Test HTTP de aislamiento (R8): firmar/confirmar/pdf de un
  inventario de B por A → 404 indistinguible, sin escribir (SELECT).
  **Cubre: R8.**

- [ ] T19 — Test HTTP de RBAC (R8): `propietario` → 403 en las 5 rutas;
  el inquilino solo firma SU inventario (el de otro inquilino → 404);
  sin token → 401. **Cubre: R8.**

- [ ] T20 — Test de auditoría y PII (R10): cada mutación genera su fila en
  `audit_log` con `entity_id` correcto y `metadata` vacío; la IP y el
  timestamp NO aparecen en logs ni en `audit_log` (viven en el dominio).
  **Cubre: R10.**

## Bloque 6 — Integración y cierre

- [ ] T21 — Escribir el mapa de trazabilidad `R1..R12 → test concreto` en
  `progress/impl_inventory_signature_pdf.md`, con las decisiones PA-14 y
  la frontera #17 (vínculo formal al contrato) anotada. **Cubre:
  trazabilidad.**

- [ ] T22 — `npm run lint`, `npm run typecheck`, `npm run test`,
  `npm run test:db` y `npm run build`; después `./init.sh` exit 0.
  **Verificación final y cierre.**
