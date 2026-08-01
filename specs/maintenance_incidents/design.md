# Design — maintenance_incidents

## 1. Modelo (PA-31-1)
Definición de workflow `incidencias` sembrada en la migración 0026:
estados Recibida → Asignada → En curso → En espera de repuesto →
Resuelta → Cerrada (+ reapertura), transiciones HUMANAS por clave con
roles. Los tickets son `workflow_instancia` con `entidad_tipo='ticket'`;
fotos en `propiedad_documento` (`tipo_documento='ticket_foto'`); el
escaneo/evidencia igual.

## 2. Rutas (6)
| Método y ruta | Rol | R |
|---|---|---|
| POST /propiedades/:id/tickets | inquilino (scoping)/admin/empleado | R1 |
| GET /tickets | scoping (R2) | R2 |
| GET /tickets/:id | scoping | R2 |
| POST /tickets/:id/comentarios | solicitante | R4 |
| POST /tickets/:id/resolucion | solicitante | R4 |
| POST /tickets/:id/costos/aprobar | propietario (scoping) | R5 |
| POST /tickets/:id/transiciones/:clave | admin/empleado | R5 (R6) |

## 3. Scoping (R2, R7)
- Inquilino: instancias cuyo `contexto.propiedad_id` pertenece a su
  contrato vigente.
- Propietario: instancias de SUS propiedades (perfil_propietario).
- Empleado/admin: todas las del tenant (RBAC + RLS del motor).

## 4. Archivos
Migración 0026 (seed de la definición, forward-only idempotente), tipos
`packages/types/src/tickets.ts`, `modules/core/tickets/` (tickets.
{service,controller}.ts), tests (creación con scoping, estados,
notificación, reapertura, aprobación de costos, seguridad, RLS del motor).
