# Implementación — feature #14 (`inventory_signature_pdf`)

**Status:** implementación completa, a la espera del review. Suite: `npm run
test` **818** + `npm run test:db` **143**. Lint, typecheck y build verdes;
`./init.sh` exit 0 (22 OK).

## Mapa de trazabilidad R1–R12 → test concreto

| R | Enunciado (resumen) | Test que lo cubre |
|---|---|---|
| R1 | PDF consolidado (zonas/ítems/respuestas/fotos) con hash SHA-256 | `firma-pdf.api.test.ts` T12 (201, hash 64 hex, `%PDF` en T16) |
| R2 | Documento en `propiedad_documento` (`inventario_firmado`) y CERRADO | `firma-pdf.api.test.ts` T12 (SELECT) y T15 (CERRADO) |
| R3 | Evidencia inmutable: firmante, timestamp, IP, hash, OTP | `firma-pdf.api.test.ts` T14 (SELECT) + `migrations.db.test.ts` (append-only, dueño) |
| R4 | Inquilino firma solo tras OTP FIRMA reciente (10 min) | `firma-pdf.api.test.ts` T15 (401 sin OTP; 201 con OTP y `otp_verificado_en`) |
| R5 | Ambas firmas del MISMO hash → FIRMADO → CERRADO; 409 al re-firmar | `firma-pdf.api.test.ts` T14/T15 + UNIQUE del motor (23505 → 409) |
| R6 | `confirmar-acuerdo`: ENVIADO/EN_REVISION + revisión completa → ACORDADO | `firma-pdf.api.test.ts` T13 (409 incompleta sin cambio; ACORDADO) |
| R7 | Descarga del PDF firmado con hash verificado | `firma-pdf.api.test.ts` T16 (hash real == registrado) |
| R8 | Aislamiento 404, RBAC 403/401, scoping del inquilino | `firma-pdf-seguridad.api.test.ts` T18/T19 |
| R9 | Sin contexto de tenant → 0 filas (motor) | `firma-rls.test.ts` T17 (conexión virgen) |
| R10 | Auditoría con metadata vacío; IP en el dominio, no en logs | `firma-pdf-seguridad.api.test.ts` T20 |
| R11 | Hash expuesto y verificado en la descarga | T16 + T20 (header `X-Hash-SHA256` == base) |
| R12 | Migración 0018 + TABLAS +1 + RUTAS +5 | `tests/migrations.test.ts` + `routes-surface.test.ts` + `migrations.db.test.ts` |

**Anclaje al PRD:** R1–R12 citan RF-I8, RF-I9, RF-I12 (frontera #17),
RF-AU3, §10.1 (Ley 527), D4, RF-C3, D2. Ningún requirement sin origen.

## Decisiones PA-14 ejecutadas (aprobadas en la puerta del spec)

| Id | Decisión | Dónde vive |
|---|---|---|
| PA-14-1 | `pdf-lib` MVP detrás de `GeneradorPdf` (sin Chromium) | `firma/generador-pdf.ts` (interfaz + impl) |
| PA-14-2 | PDF en `propiedad_documento` (#6) con `entidad_tipo/entidad_id` nuevos; vínculo al contrato en #17 | migración 0018 (ALTER idempotente) + `generarPdf` |
| PA-14-3 | Acuerdo por `confirmar-acuerdo`; la negociación de #22 insertará `EN_NEGOCIACION → ACORDADO` | `FirmaPdfService.confirmarAcuerdo` (acepta ENVIADO/EN_REVISION) |
| PA-14-4 | Firma propia tras `ServicioFirma` (interfaz, Ley 527); proveedor enchufable | `firma/servicio-firma.ts` + evidencia en `inventario_firma` |

## Fronteras anotadas (lo que #14 NO hace)

- **#17:** el vínculo FORMAL contrato ↔ inventario firmado lo añade la
  feature de contratos; aquí el documento queda en el repositorio
  documental con su hash (PA-14-2).
- **#22:** la negociación multironda insertará `EN_NEGOCIACION → ACORDADO`;
  `confirmar-acuerdo` acepta tanto `ENVIADO` (lo que produce #13) como
  `EN_REVISION`.
- **Proveedor certificado:** la interfaz `ServicioFirma` queda lista (D4).

## Notas de implementación

- `propiedad_documento` no tenía vínculo de entidad: se añadieron
  `entidad_tipo`/`entidad_id` (ALTER idempotente en 0018) para localizar
  el PDF por inventario (PA-14-2).
- El PDF se genera sin fechas automáticas (`setCreationDate(new Date(0))`):
  el MISMO contenido produce el MISMO hash — requisito de R5 (ambas partes
  firman el mismo documento).
- `confirmar-acuerdo` acepta `ENVIADO` (estado real tras la invitación de
  #13) además de `EN_REVISION` (frontera #22), siempre con revisión
  completa (R6).
- El UNIQUE del motor (una firma por parte) se traduce en 409
  `DOCUMENTO_NO_FIRMABLE` (23505 → error de dominio).
