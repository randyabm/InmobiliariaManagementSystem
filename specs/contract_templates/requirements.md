# Requirements — contract_templates

> Feature #16. Plantillas de contrato en tres ámbitos.
> Anclaje al PRD: **RF-CT1** (clausulado común del tenant con merge
> fields), **RF-CT2** (borrador propuesto al ingresar la propiedad,
> validado y guardado como template de la propiedad), **§13.2**, **D2**.

Notación EARS estricta. Un solo DEBE por requirement.

## Dependencias
- **#6 (done):** la propiedad y su hoja de vida (RF-P1).
- **#11 (done):** el patrón de plantillas del sistema (PA-11-1) se reutiliza
  para el clausulado común del tenant.

## Fronteras
- **Merge y PDF (RF-CT3):** #17. Aquí solo vive el template (cuerpo +
  merge fields + validación).
- **Firma (RF-CT4) y digitalización (RF-CT6/7):** #17 y #18.

---

### R1 — (RF-CT1) Clausulado común del tenant
CUANDO un usuario con rol `admin` o `empleado` invoca `GET
/plantillas-contrato`, el sistema DEBE responder la plantilla base del
tenant (nombre, cuerpo, merge fields, versión, estado) o 404 si aún no
existe; y CUANDO invoca `POST /plantillas-contrato`, DEBE crear la plantilla
base (una sola por tenant: la segunda creación responde 409) con
`estado = 'borrador'` y `version = 1`.

### R2 — (RF-CT1, RF-CT2) Edición y validación
CUANDO un usuario con rol `admin` o `empleado` invoca `PATCH
/plantillas-contrato` (o `POST /plantillas-contrato/validar`), el sistema
DEBE actualizar cuerpo/merge fields del template del tenant (o marcarlo
`validado` con `validado_por` = el usuario autenticado) y DEBE incrementar
`version` en cada edición posterior a la validación. La validación DEBE
registrarse en `audit_log`.

### R3 — (RF-CT2) Borrador propuesto para la propiedad
CUANDO un usuario con rol `admin` o `empleado` invoca `POST
/propiedades/:id/contrato/plantilla`, el sistema DEBE crear (si no existe)
una copia del template base con los campos de la propiedad (dirección,
canon, administración, cuenta destino) pre-rellenados en
`merge_fields_json`, `estado = 'borrador'`, y DEBE responder la copia; la
segunda creación para la misma propiedad responde 409. `GET
/propiedades/:id/contrato/plantilla` DEBE devolverla (404 si no existe).

### R4 — (RF-CT2) Validación del template de la propiedad
CUANDO un usuario con rol `admin` o `empleado` invoca `POST
/propiedades/:id/contrato/plantilla/validar`, el sistema DEBE marcar la
plantilla de la propiedad como `validado` (solo `admin` puede validar;
`empleado` responde 403) y DEBE auditar la acción.

### R5 — (RF-CT1, RF-C3) Aislamiento y autorización
SI una petición de otro tenant consulta o modifica una plantilla ENTONCES
el sistema DEBE responder 404 sin revelar su existencia. SI un rol sin
permiso invoca los endpoints DEBE responder 403 (401 sin token).

### R6 — (C4/C6) Migración versionada
EL sistema DEBE crear la tabla `contract_template` en una única migración
versionada, forward-only e idempotente, con RLS ENABLE+FORCE y política por
`tenant_id`, `UNIQUE (tenant_id, property_id)` (NULL base = una por
tenant) y `UNIQUE (tenant_id) WHERE property_id IS NULL`; `TABLAS_PERMITIDAS`
(+1) y `RUTAS_PERMITIDAS` (+6) DEBEN actualizarse en el mismo cambio.

---

## CRITERIOS DE ACEPTACIÓN (feature_list #16)
| Criterio | R |
|---|---|
| La inmobiliaria define su clausulado común con campos variables | R1, R2 |
| Al ingresar la propiedad se propone el borrador pre-relleno | R3 |
| El template de la propiedad se valida (solo admin) y versiona | R2, R4 |
| Aislamiento y RBAC | R5 |

## DECISIONES de la puerta del spec
| Id | Decisión propuesta | Motivo |
|---|---|---|
| PA-16-1 | El template base del tenant es UNO (property_id NULL); el borrador de la propiedad es una COPIA, no un puntero | La copia permite ajustes sin contaminar la base (mismo patrón que #11) |
| PA-16-2 | Merge fields validados con zod: `{campo}` en el cuerpo debe existir en `merge_fields_json` | Evita un merge roto en #17 |
| PA-16-3 | La validación del template de la propiedad es solo `admin`; la base la editan admin/empleado | RF-CT2: «el admin/agente lo valida, ajusta y guarda» |

No quedan preguntas de producto abiertas.
