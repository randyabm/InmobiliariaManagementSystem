# Design — inventory_signature_pdf

> Feature #14. Firma electrónica y PDF del inventario (RF-I8, RF-I9,
> RF-I12, RF-AU3, D4, §10.1). Cierra el ciclo del inventario del §8.7.

---

## 1. El flujo de cierre

```
EN_REVISION ──(empleado: confirmar-acuerdo, exige revisión completa, R6)──▶ ACORDADO
ACORDADO ──(firma EMPLEADO, R3)────────────────────────────────────────────▶ (espera)
ACORDADO ──(firma INQUILINO con OTP FIRMA, R4)─────────────────────────────▶ (espera)
  ambas con el MISMO hash → FIRMADO (R5)
FIRMADO ──(PDF almacenado en propiedad_documento, R2)─────────────────────▶ CERRADO
```

## 2. Interfaz y proveedores (D4, PA-14-1/4)

```ts
// generador-pdf.ts (interfaz)
interface GeneradorPdf {
  generar(datos: PdfInventario): Promise<{ binario: Buffer; hash_sha256: string }>;
}
// implementación MVP: pdf-lib (PA-14-1) — texto + fotos incrustadas (JPEG)

// servicio-firma.ts (interfaz, PA-14-4)
interface ServicioFirma {
  firmar(datos: { inventarioId, firmanteTipo, usuarioId, hashDocumento,
                  ip, otpVerificadoEn? }): Promise<FirmaRegistrada>;
}
// implementación MVP: registra la evidencia en inventario_firma (Ley 527)
```

El proveedor certificado se enchufa detrás de `ServicioFirma` sin tocar el
servicio de inventarios (patrón de proveedores de #10).

## 3. PDF consolidado (R1)

`PdfInventario` = propiedad (dirección, tipo) + inventario (tipo_evento,
fecha) + zonas/ítems con respuesta, comentario y fotos (leídas de MinIO vía
`urlTemporal` de #6 y descargadas para incrustar). El hash SHA-256 se
calcula del binario final (R11). Con `pdf-lib`:

- Página 1: cabecera (propiedad, evento, fecha) y las zonas con sus ítems
  en tablas (nombre, respuesta, comentario).
- Páginas siguientes: una foto por página (o 2×2) con su ítem.
- Firma: dos líneas «Firma EMPLEADO (fecha, hash)` y «Firma INQUILINO
  (fecha, hash)` — la evidencia completa vive en `inventario_firma`.

## 4. Firma y evidencia (R3, R4)

`inventario_firma` (append-only, triggers como `audit_log`):
id, tenant_id, inventario_id FK, firmante_tipo CHECK (EMPLEADO, INQUILINO),
firmante_user_id, hash_documento (SHA-256), ip, otp_verificado_en NULL,
created_at. UNIQUE (inventario_id, firmante_tipo) — una firma por parte
(la segunda vez es 409).

- Firma del EMPLEADO: `POST /inventarios/:id/firmas/empleado` — exige
  `ACORDADO`, registra IP/timestamp/hash.
- Firma del INQUILINO: `POST /inventarios/:id/firmas/inquilino` — exige
  `ACORDADO`, el scoping de #13 (solo su inventario, R9) y un OTP `FIRMA`
  verificado en los últimos 10 min (R4, infraestructura de #13: se consulta
  `codigo_otp` con propósito FIRMA, `verificado_en` reciente y sin
  consumir).
- Ambas firmas con el mismo `hash_documento` → `FIRMADO` (R5).

## 5. Almacenamiento y cierre (R2, R7)

El PDF firmado se guarda con `AlmacenamientoService.subir` (#6) y la fila
en `propiedad_documento` (`tipo_documento = 'inventario_firmado'`, hash) —
repositorio documental de #6 (PA-14-2). Luego `CERRADO`. `GET
/inventarios/:id/pdf` devuelve el binario y expone el hash (R11): lee la
fila activa de `propiedad_documento` con ese tipo, descarga de MinIO y
verifica el hash antes de responder.

## 6. Superficie HTTP (4 rutas)

| Método y ruta | Rol | R |
|---|---|---|
| `POST /inventarios/:id/confirmar-acuerdo` | admin/empleado | R6 |
| `POST /inventarios/:id/pdf` | admin/empleado | R1 |
| `POST /inventarios/:id/firmas/empleado` | admin/empleado | R3, R5 |
| `POST /inventarios/:id/firmas/inquilino` | inquilino (scoping #13) | R3, R4, R5 |
| `GET /inventarios/:id/pdf` | admin/empleado (y inquilino de #13 con su scoping) | R7 |

## 7. Migración (`0018_inventory_signature_pdf.sql`, R12)

`inventario_firma` con RLS ENABLE+FORCE, CHECKs, UNIQUE por parte, y los
triggers append-only (`trg_firma_no_update`/`no_delete`, función
`inventario_firma_prevent_mutation`). Sin cambios en otras tablas.

## 8. Errores de dominio

| Error | `code` | HTTP | Cuándo |
|---|---|---|---|
| `AcuerdoIncompletoError` (nuevo) | `ACUERDO_INCOMPLETO` | 409 | R6: revisión sin completar |
| `DocumentoNoFirmableError` (nuevo) | `DOCUMENTO_NO_FIRMABLE` | 409 | R5: estado ≠ ACORDADO o ya firmado |
| `FirmaSinOtpError` (nuevo) | `FIRMA_SIN_OTP` | 401 | R4: OTP FIRMA no verificado recientemente |
| `ResourceNotFoundError` (reutilizado) | `RESOURCE_NOT_FOUND` | 404 | R8 |

## 9. Archivos

Se crean: migración `0018`, schema `inventario-firma.ts`,
`modules/core/inventarios/firma/` (firma-pdf.{generator,service,controller,
repository}.ts, generador-pdf.ts interfaz + pdf-lib impl, servicio-firma.ts
interfaz + impl evidencia, errores), `packages/types/src/inventario-firma.ts`,
tests.

Se modifican: `schema/index.ts`, `_journal.json`, `tests/migrations.test.ts`
(+1), `routes-surface.test.ts` (+5), `migrations.db.test.ts` (tabla +
triggers append-only), `inventarios.module.ts` (+firma), `package.json` de
`apps/api` (+`pdf-lib`), `feature_list.json`.

## 10. Alternativas descartadas

1. **Puppeteer (PRD §13.1).** Descartada para el MVP (PA-14-1): Chromium en
   cada CI es pesado; `pdf-lib` construye el PDF consolidado sin navegador
   y la interfaz permite enchufar Puppeteer si se necesita HTML→PDF.
2. **Guardar el PDF en una tabla propia.** Descartada (PA-14-2): el
   repositorio documental de #6 ya existe y cumple RF-I12 en su parte de
   almacenamiento.
3. **Firma sin OTP (solo sesión).** Descartada: RF-AU3 lo exige y #13 ya
   entregó la infraestructura (R4).

## 11. Estado de las ambigüedades

Las cuatro decisiones de la puerta (PA-14-1…PA-14-4) quedan explícitas. La
negociación (#22) se insertará entre `EN_REVISION` y `ACORDADO` cuando
exista (R6). No quedan ambigüedades de producto.
