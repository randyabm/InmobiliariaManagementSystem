# Requirements — insurance_policy

> Feature #20. Afianzamiento y captura de póliza (RF-PI7, RF-PI8, §12.4).

### R1 — (RF-PI7) Envío del candidato a la aseguradora
CUANDO un usuario con rol `admin` o `empleado` invoca `POST
/propiedades/:id/polizas` con `{ aseguradora, estado: 'en_estudio',
observaciones? }`, el sistema DEBE crear la póliza en `en_estudio` y
responder 201. SI la propiedad no existe en el tenant ENTONCES 404.

### R2 — (RF-PI8) Resultado y captura del documento
CUANDO un usuario con rol `admin` o `empleado` invoca `PATCH
/polizas/:id` con `{ estado: 'aprobada'|'rechazada', numero_poliza?,
vigencia_desde?, vigencia_hasta?, valor_cobertura? }` y/o `POST
/polizas/:id/documento` (multipart PDF), el sistema DEBE actualizar la
póliza y almacenar el binario en object storage con hash SHA-256 (fila en
`propiedad_documento` con `tipo_documento='poliza'`, vínculo
`entidad_tipo='poliza'`), respondiendo 200/201.

### R3 — (RF-PI8, RF-C3) Consulta y aislamiento
CUANDO un usuario con rol `admin` o `empleado` invoca `GET
/propiedades/:id/polizas` o `GET /polizas/:id`, el sistema DEBE responder
las pólizas de la propiedad (con su estado y vigencia); una petición de
otro tenant DEBE responder 404 sin revelar existencia. Sin token → 401.

### R4 — (C4/C6) Migración versionada
EL sistema DEBE crear `insurance_policy` en una única migración (RLS
ENABLE+FORCE, CHECK estado, CHECK vigencia_hasta > vigencia_desde cuando
ambas existen), con `TABLAS_PERMITIDAS` (+1) y `RUTAS_PERMITIDAS` (+4)
actualizadas en el mismo cambio.

## DECISIONES de la puerta
| Id | Decisión |
|---|---|
| PA-20-1 | El PDF de la póliza vive en `propiedad_documento` (tipo `poliza`, entidad `poliza`) — repositorio documental de #6 |
| PA-20-2 | La póliza se vincula al contrato por `contract_id` opcional (se llena al arrendar) |
