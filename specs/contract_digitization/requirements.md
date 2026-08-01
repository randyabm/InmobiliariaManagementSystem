# Requirements — contract_digitization

> Feature #18. Digitalización de contratos físicos existentes (RF-CT6,
> RF-CT7, §13.4, Escenario B).

### R1 — (RF-CT6) Subir el escaneo con metadatos
CUANDO un usuario con rol `admin` o `empleado` envía
`POST /contratos/digitalizados` (multipart: archivo PDF + `nombre` +
metadatos `{ propiedad_id, inquilino_id?, fecha_inicio?, fecha_fin?,
canon?, contract_id? }`), el sistema DEBE almacenar el binario en object
storage con hash SHA-256 y crear la fila en `contract_document`
(origen `digitalizado`) vinculada al contrato (el `contract_id` recibido o
uno creado con los metadatos: `vigente`), DEBE responder 201 con el
documento y el hash. El binario NO DEBE quedar en la base.

### R2 — (RF-CT7) Vincular como documento del contrato
CUANDO el documento digitalizado queda creado, el sistema DEBE listarlo
junto a los generados en `GET /contratos/:id/documentos` y en
`GET /propiedades/:id/contratos/documentos`, manteniendo el único sistema
de verdad. SI el `property_id` recibido no existe en el tenant ENTONCES
404.

### R3 — (RF-C3, C7) Aislamiento, RBAC e integridad
SI una petición de otro tenant consulta o sube un documento ENTONCES 404
sin revelar existencia. Roles: admin/empleado; sin token 401. La descarga
(`GET /contratos/:id/documentos/:idDocumento/pdf`) DEBE verificar el hash
antes de responder.

### R4 — (C4/C6) Migración versionada
EL sistema DEBE crear `contract_document` en una única migración (RLS
ENABLE+FORCE, CHECK origen, hash 64), con `TABLAS_PERMITIDAS` (+1) y
`RUTAS_PERMITIDAS` (+4) actualizadas en el mismo cambio.

## DECISIONES de la puerta
| Id | Decisión |
|---|---|
| PA-18-1 | El escaneo puede crear el contrato con los metadatos (fechas, canon) o vincularse a uno existente por `contract_id` |
| PA-18-2 | El documento vive en `contract_document` (tabla propia), no en `propiedad_documento` — es un documento del CONTRATO, no de la hoja de la propiedad |
