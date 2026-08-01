# Requirements — inventory_signature_pdf

> Feature #14. Firma electrónica y PDF del inventario.
> Anclaje al PRD: **RF-I8** (PDF consolidado), **RF-I9** (firma con
> evidencia: timestamp, IP, verificación de identidad), **RF-I12**
> (documento final como anexo del contrato — frontera con #16/#17),
> **RF-AU3** (OTP antes de la firma — infraestructura de #13), **D4**
> (firma tras interfaz abstracta, proveedor certificado enchufable),
> **§10.1** (Ley 527: evidencia de trazabilidad + hash SHA-256).

Notación EARS estricta (`docs/specs.md`). Un solo `DEBE` por requirement.

## Dependencias

- **#13 `inventory_tenant_review` (done):** la revisión completada
  (`revision_completada_en`) y el OTP con propósito `FIRMA` (R8 de #13)
  que esta feature exige al firmar.
- **#12 `inventory_creation` (done):** el inventario y sus fotos.
- **#6 (done):** el repositorio documental (`propiedad_documento`) donde se
  guarda el PDF firmado.

## Fronteras explícitas (qué NO es de #14)

- **Anexo FORMAL al contrato (RF-I12):** el vínculo
  contrato ↔ inventario firmado lo añadirá la feature **#17** (la tabla de
  contratos no existe). #14 deja el PDF en el repositorio documental de la
  propiedad (`tipo_documento = 'inventario_firmado'`) y la referencia lista.
- **Negociación multironda (RF-I6):** #22. Esta feature opera sobre el
  acuerdo final.

---

## Grupo A — PDF consolidado (RF-I8)

### R1 — (RF-I8) Generar el PDF

CUANDO un usuario con rol `admin` o `empleado` invoca
`POST /inventarios/:id/pdf`, el sistema DEBE generar el documento PDF
consolidado del inventario —datos de la propiedad, zonas, ítems con su
respuesta y comentario, y las fotos (de ambos autores) incrustadas— con el
hash SHA-256 del binario calculado, y DEBE responder 200 con el PDF y su
hash. La generación DEBE pasar por una interfaz abstracta `GeneradorPdf`
(D4: la implementación MVP es sustituible sin tocar el servicio).

### R2 — (RF-I8, RF-I9) El documento firmado se guarda con su hash

CUANDO el documento está firmado (R5), el sistema DEBE almacenar el PDF en
object storage (#6) y registrar la fila en `propiedad_documento` con
`tipo_documento = 'inventario_firmado'`, `hash_sha256` y la referencia al
inventario; el inventario DEBE quedar en `CERRADO`.

---

## Grupo B — Firma con evidencia (RF-I9, RF-AU3, D4, §10.1)

### R3 — (RF-I9) La firma registra evidencia inmutable

CUANDO una parte firma, el sistema DEBE registrar en `inventario_firma`
(append-only) el `firmante_tipo` (`EMPLEADO` o `INQUILINO`), el usuario, el
timestamp, la IP de la petición, el hash SHA-256 del documento firmado y
(para el inquilino) la verificación OTP con su timestamp. El registro DEBE
ser inmutable (triggers).

### R4 — (RF-I9, RF-AU3) El inquilino firma solo tras OTP

CUANDO el inquilino firma (`POST /inventarios/:id/firmas/inquilino`), el
sistema DEBE exigir un OTP de propósito `FIRMA` recién verificado (ventana
de 10 min, infraestructura de #13) y rechazar la firma con 401 si no lo
hay; la evidencia DEBE incluir `otp_verificado_en`.

### R5 — (RF-I9) Ambas firmas cierran el acuerdo

CUANDO `EMPLEADO` e `INQUILINO` han firmado el MISMO documento (mismo
hash), el sistema DEBE transicionar el inventario de `ACORDADO` a
`FIRMADO`; y CUANDO el PDF firmado se almacena (R2), a `CERRADO`. El
documento NO se puede volver a firmar (409 si ya está `FIRMADO`/`CERRADO`).

### R6 — (RF-I9) El acuerdo previo

CUANDO un usuario con rol `admin` o `empleado` invoca
`POST /inventarios/:id/confirmar-acuerdo`, el sistema DEBE transicionar el
inventario de `EN_REVISION` a `ACORDADO` SI la revisión del inquilino está
completada (`revision_completada_en` NOT NULL); si no, DEBE responder 409
sin cambiar nada. (#22 insertará la negociación entre medias cuando
exista.)

### R7 — (RF-I12, #6) Descargar el PDF firmado

CUANDO un usuario autorizado invoca `GET /inventarios/:id/pdf`, el sistema
DEBE responder el PDF firmado almacenado (404 si aún no existe) con su
hash verificable.

---

## Grupo C — Invariantes de seguridad (obligatorios, `docs/specs.md`)

### R8 — (RF-A1, RF-C3) Aislamiento y autorización

SI una petición autenticada en el tenant A firma, confirma o descarga un
inventario del tenant B ENTONCES el sistema DEBE responder 404 sin revelar
su existencia. SI un usuario sin el rol requerido invoca los endpoints
DEBE responder 403 (401 sin token); la firma del inquilino DEBE estar
restringida a SU inventario (scoping de #13, R9).

### R9 — (RF-C3, `docs/architecture.md`) Sin contexto de tenant, falla

SI un repositorio de esta feature se ejecuta sin contexto de tenant
establecido ENTONCES el sistema DEBE fallar con `SinContextoDeTenantError`.

### R10 — (RF-W4, §11.3, Ley 1581) Auditoría y PII

CUANDO se confirma el acuerdo, se firma o se guarda el PDF, el sistema DEBE
registrar la entrada en `audit_log` con `tenant_id`, `actor_id`, `accion`,
`entity_type` y `entity_id`, con `metadata` vacío; la IP y los timestamps
de la firma viven en `inventario_firma` (dominio), nunca en logs ni en
`audit_log.metadata`.

### R11 — (C7) Integridad documental

EL sistema DEBE exponer el `hash_sha256` del PDF firmado y DEBE verificarlo
al descargar (el hash del binario devuelto DEBE coincidir con el
registrado).

---

## Grupo D — Gobernanza del cambio

### R12 — (D2, `docs/conventions.md`, C4/C6) Migración versionada y listas al día

EL sistema DEBE aplicar los cambios de esquema en una única migración
versionada, forward-only e idempotente (previsiblemente
`0018_inventory_signature_pdf.sql`: tabla `inventario_firma` append-only +
sus triggers), y `TABLAS_PERMITIDAS` (+1) y `RUTAS_PERMITIDAS` (+4) DEBEN
actualizarse en el mismo cambio.

---

## CRITERIOS DE ACEPTACIÓN del humano (feature_list.json #14)

| Criterio | R que lo satisface |
|---|---|
| Al alcanzar el acuerdo el contenido queda bloqueado e inmutable | R5 (FIRMADO/CERRADO, 409 al re-firmar) |
| Se genera un PDF consolidado con zonas, ítems, fotos y comentarios finales | R1 |
| Firma de ambas partes con evidencia: timestamp, IP, método de verificación y hash SHA-256 del documento | R3, R4 |
| Queda constancia del consentimiento expreso para usar medios electrónicos | R3 (fila de firma con la evidencia; el consentimiento se registra en la fila) |
| El documento final se vincula como anexo del contrato | R2, R7 (frontera #17 para el vínculo formal) |
| La firma se implementa tras una interfaz abstracta que permita enchufar un proveedor certificado después | R1, R3 (GeneradorPdf + ServicioFirma tras interfaz, D4) |

## DECISIONES que el humano confirma en la puerta del spec

| Id | Pregunta | Decisión propuesta | Motivo |
|---|---|---|---|
| **PA-14-1** | ¿Generador de PDF? | **`pdf-lib` MVP detrás de la interfaz `GeneradorPdf`** (sin Chromium): el PDF se construye en JS puro con las fotos incrustadas; Puppeteer (PRD §13.1) queda como proveedor enchufable si el HTML→PDF se necesita | Añadir Puppeteer es descargar Chromium en cada CI; pdf-lib es suficiente para el PDF consolidado y testeable |
| **PA-14-2** | ¿Dónde vive el PDF firmado? | En `propiedad_documento` (#6) con `tipo_documento = 'inventario_firmado'`; el vínculo formal al contrato lo añade #17 | El repositorio documental ya existe; no se crea otra tabla de documentos |
| **PA-14-3** | ¿Pre-firma? | La firma parte de `ACORDADO`, alcanzado por `confirmar-acuerdo` (R6: EN_REVISION + revisión completa); #22 insertará la negociación | El lote se cierra sin depender de #22 |
| **PA-14-4** | ¿Firma MVP? | Firma propia que registra la evidencia (Ley 527) tras `ServicioFirma` (interfaz, D4); el proveedor certificado se enchufa después | Mismo patrón que proveedores de #10 |

**No quedan preguntas de producto abiertas** (las cuatro decisiones quedan
explícitas para la puerta del spec).
