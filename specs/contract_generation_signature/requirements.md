# Requirements — contract_generation_signature

> Feature #17. Generación del contrato (merge) y firma electrónica.
> Anclaje al PRD: **RF-CT3** (merge: template de la propiedad + datos del
> inquilino → PDF), **RF-CT4** (firma con la misma evidencia que
> inventarios: OTP, IP, timestamp, hash), **RF-CT5** (almacenamiento
> vinculado a propiedad/propietario/inquilino), **RF-I12** (el inventario
> final como anexo formal), **§13.3**, **Ley 527**, **D4**.

Notación EARS estricta. Un solo DEBE por requirement.

## Dependencias
- **#16 (done):** el template de la propiedad validado.
- **#14 (done):** el patrón de firma con evidencia (append-only, OTP).
- **#13 (done):** el OTP con propósito `FIRMA`.
- **#6 (done):** `propiedad_documento` (el contrato firmado vive ahí).

## Fronteras
- **Digitalización de físicos (RF-CT6/7):** #18.
- **Renovaciones (RF-CT8..13):** #19.

---

### R1 — (RF-CT3) Generar el contrato por merge
CUANDO un usuario con rol `admin` o `empleado` invoca `POST
/propiedades/:id/contratos` con `{ inquilino_id, fecha_inicio, fecha_fin,
codeudor_id? }`, el sistema DEBE crear el contrato (merge del template
validado de la propiedad con los campos del inquilino), generar el PDF
(interfaz `GeneradorPdf` de #14), materializarlo en `propiedad_documento`
(tipo `contrato_generado`) y DEBE responder 201 con el contrato y el hash.
SI el template de la propiedad no está `validado` ENTONCES 409.

### R2 — (RF-CT3, RF-C3) El inquilino existe y pertenece al tenant
CUANDO el `inquilino_id` recibido no existe en el tenant ENTONCES el
sistema DEBE responder 404. El contrato DEBE guardar
`propiedad_id, inquilino_id, propietario_id (principal), fecha_inicio,
fecha_fin, estado [vigente]`.

### R3 — (RF-CT4) Firma con evidencia (ambas partes)
CUANDO el empleado firma (`POST /contratos/:id/firmas/empleado`) y el
inquilino firma (`POST /contratos/:id/firmas/inquilino` — OTP `FIRMA`
reciente + scoping por perfil), el sistema DEBE registrar en
`contrato_firma` (append-only) firmante, timestamp, IP, hash del documento
y (inquilino) `otp_verificado_en`; CUANDO ambas partes firmaron el MISMO
hash, el contrato DEBE pasar a `firmado`. El UNIQUE por parte devuelve 409
al re-firmar.

### R4 — (RF-CT5, RF-I12) Anexo del inventario y almacenamiento
CUANDO el contrato se genera, el sistema DEBE vincular como anexo el
último inventario `CERRADO` de la propiedad (RF-I12) si existe
(`propiedad_documento` con `entidad_tipo='contrato'`,
`entidad_id=contrato`, `tipo_documento='inventario_firmado_anexo'`), y DEBE
quedar el PDF del contrato en `propiedad_documento` (`contrato_generado` y,
tras firmar, `contrato_firmado`), consultable por propiedad, propietario e
inquilino (GET /contratos, GET /contratos/:id).

### R5 — (RF-CT4, RF-AU3) El inquilino firma solo con OTP
CUANDO el inquilino firma sin un OTP `FIRMA` verificado en los últimos 10
minutos, el sistema DEBE responder 401 uniforme. El scoping (R9 de #13):
solo el inquilino asignado al contrato firma (404 si no).

### R6 — (RF-C3, C7) Aislamiento, RBAC e integridad
SI una petición de otro tenant consulta o firma un contrato ENTONCES 404
sin revelar existencia. Los roles: generación y firma del empleado
admin/empleado; firma del inquilino rol `inquilino`; sin token 401. La
descarga (`GET /contratos/:id/pdf`) DEBE verificar el hash SHA-256 del
binario antes de responder (R11 de #14).

### R7 — (C4/C6) Migración versionada
EL sistema DEBE crear `contract` y `contrato_firma` en una única migración
(RLS ENABLE+FORCE, CHECKs, UNIQUE (contrato, firmante), triggers
append-only de la firma), y `TABLAS_PERMITIDAS` (+2) y `RUTAS_PERMITIDAS`
(+7) DEBEN actualizarse en el mismo cambio.

---

## CRITERIOS DE ACEPTACIÓN (feature_list #17)
| Criterio | R |
|---|---|
| Arrendar es casi un clic: merge del template validado + inquilino → PDF | R1 |
| Firma de ambas partes con evidencia (OTP, IP, timestamp, hash) | R3, R5 |
| El inventario firmado queda como anexo formal del contrato (RF-I12) | R4 |
| El contrato firmado queda vinculado y descargable con integridad | R4, R6 |

## DECISIONES de la puerta del spec
| Id | Decisión propuesta | Motivo |
|---|---|---|
| PA-17-1 | El PDF del contrato reutiliza `GeneradorPdf` de #14 (pdf-lib MVP), con el cuerpo del template mergeado | Sin Chromium; interfaz enchufable |
| PA-17-2 | Los documentos del contrato viven en `propiedad_documento` con `entidad_tipo='contrato'` (no tabla nueva) | El repositorio documental de #6 ya existe (PA-14-2) |
| PA-17-3 | El anexo del inventario CERRADO se crea en la generación (RF-I12) | El inventario se cierra antes de arrendar |

No quedan preguntas de producto abiertas.
