# Requirements — maintenance_incidents

> Feature #31. Autogestión de reclamos y reparaciones (RF-M1..M7, §6.5).
> Fase 3. Los tickets se modelan sobre el motor de workflows (RF-W1) y
> usan object storage (#6) para las fotos.

### R1 — (RF-M1, RF-M3) Crear una solicitud
CUANDO un usuario con rol `inquilino` (de la propiedad ocupada) o
`admin`/`empleado` envía `POST /propiedades/:id/tickets` con `{ categoria,
descripcion, fotos? }`, el sistema DEBE crear el ticket (instancia del
workflow de incidencias en `Recibida`), subir las fotos a object storage
(hash) y DEBE responder 201. El inquilino SOLO para la propiedad que
ocupa (scoping por contrato vigente; 404 si no).

### R2 — (RF-M2, RF-W1) Máquina de estados y consulta
CUANDO un usuario consulta `GET /tickets` o `GET /tickets/:id`, el sistema
DEBE responder el ticket con su estado actual y las transiciones
disponibles (motor de workflows #7, definición de incidencias sembrada con
los estados del PRD: Recibida → Asignada → En curso → En espera de
repuesto → Resuelta → Cerrada). El inquilino ve SOLO sus solicitudes; el
propietario SOLO las de sus propiedades (RF-M7, scoping).

### R3 — (RF-M3) Notificaciones y auditoría
CUANDO un ticket cambia de estado, el sistema DEBE notificar al solicitante
por el motor de #10 (canal preferido, RF-C4) y DEBE registrar la transición
en la auditoría (RF-W4).

### R4 — (RF-M4) Comentarios, evidencia y aceptación
CUANDO el solicitante invoca `POST /tickets/:id/comentarios` (multipart
con fotos opcionales) o `POST /tickets/:id/resolucion` con
`{ aceptada: true|false }`, el sistema DEBE registrar el comentario con su
evidencia y, si la resolución se rechaza, DEBE reabrir el ticket
(transición a `En curso`); si se acepta, DEBE pasarlo a `Cerrada`.

### R5 — (RF-M5, RF-M6) Aprobación de costos y gestión
CUANDO el flujo lo requiere, el sistema DEBE pedir la aprobación de costos
al propietario (`POST /tickets/:id/costos/aprobar` con
`{ aprobado: true|false }` y scoping de sus propiedades) ANTES de la
ejecución; y CUANDO un `admin`/`empleado` invoca la transición (asignar a
proveedor, registrar avance, cerrar), el motor DEBE ejecutarla por clave
con seguimiento de SLA (tiempo en estado).

### R6 — (RF-C3, C4/C6) Aislamiento y migración
SI una petición de otro tenant consulta o muta un ticket ENTONCES 404 sin
revelar existencia. Los roles: creación/consulta según R1/R2/R5; sin token
401. La definición del workflow de incidencias se siembra en una migración
(reutiliza el motor de #7, sin tablas de tickets propias: los tickets SON
instancias `workflow_instancia` con `entidad_tipo='ticket'` y su contexto);
`RUTAS_PERMITIDAS` (+6) actualizada.

## DECISIONES de la puerta
| Id | Decisión |
|---|---|
| PA-31-1 | Los tickets NO tienen tabla propia: son instancias del motor de #7 (`entidad_tipo='ticket'`, contexto con categoria/descripcion/datos); la definición se siembra por migración con los estados del PRD |
| PA-31-2 | La aprobación de costos es un campo del contexto + transición `aprobar_costos` con roles [propietario]; sin tabla de presupuestos en esta iteración |
| PA-31-3 | El SLA se mide con `tiempo_en_estado_segundos` del motor (ya existe de #8) |

Sin preguntas de producto abiertas.
