# Design — inventory_paper_format

## 1. Endpoints (3)
| Método y ruta | Rol | R |
|---|---|---|
| POST /inventarios/:id/formato-papel | admin/empleado | R1 |
| POST /inventarios/:id/reconstruir | admin/empleado | R2 |
| POST /inventarios/:id/confirmar-papel | admin/empleado | R3 |

## 2. Formato (R1, PA-29-1)
`GeneradorPdf` (#14) con zonas/ítems en tabla (sin fotos), columnas
«Notas del agente»/«Notas del inquilino», firma manuscrita (líneas) y el
ID del inventario + QR (PA-29-1). Requiere estado BORRADOR (409).

## 3. Reconstrucción (R2, PA-29-2)
Body multipart: `notas_agente`, `notas_inquilino` (por zona/ítem),
fotos (multipart con `item_id`), `escaneo_papel` (PDF). Actualiza
`inventario_item.comentario`/`valor_respuesta` según las notas y sube las
fotos por el flujo de #12 (`autor='EMPLEADO'`). El escaneo va a
`propiedad_documento` con `tipo_documento='inventario_papel'` y vínculo
`entidad_tipo='inventario'`.

## 4. Confirmación (R3, PA-29-3)
`confirmar-papel` transiciona BORRADOR → ENVIADO (igual que la invitación
de #13): el inquilino confirma por el flujo existente (OTP + revisión).
El escaneo del papel queda como evidencia de respaldo.

## 5. Archivos
`modules/core/inventarios/papel/` (formato-papel.{service,controller}.ts),
reutiliza `GeneradorPdf`, `InventariosRepository` y el flujo de #13.
Tests: generación (binario %PDF sin fotos, 409 fuera de BORRADOR),
reconstrucción (SELECT de comentarios/fotos/escaneo), confirmación
(ENVIADO), seguridad (404/401).
