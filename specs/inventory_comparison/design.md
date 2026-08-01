# Design — inventory_comparison

## 1. Endpoint
GET /inventarios/:idEntrada/comparar/:idSalida (admin/empleado). Solo
lectura: sin @Audit, sin escrituras (R2).

## 2. Algoritmo (PA-21-1/2)
Por cada zona de la entrada, se busca su pareja por nombre en la salida;
por cada ítem, pareja por plantilla_item_id (o nombre si es ad-hoc).
Veredictos: igual (misma respuesta/estado_checklist), diferente,
ausente_en_salida. Comentarios van en el detalle; no cambian el veredicto.
