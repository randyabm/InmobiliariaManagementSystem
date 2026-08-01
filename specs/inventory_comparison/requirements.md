# Requirements — inventory_comparison

> Feature #21. Comparación entrada vs salida (RF-I10, §8.7: «facilitar la
> evaluación de daños o deducciones de depósito»).

### R1 — (RF-I10) Comparar dos inventarios
CUANDO un usuario con rol `admin` o `empleado` invoca `GET
/inventarios/:idEntrada/comparar/:idSalida`, el sistema DEBE comparar ítem
por ítem (mismo `plantilla_item_id` o nombre) entre el inventario de
entrada y el de salida y DEBE responder el resumen: totales de ítems,
iguales, diferentes y ausentes, y el detalle de diferencias (respuesta de
entrada vs de salida, comentarios). SI cualquiera de los dos no existe en
el tenant ENTONCES 404; SI son el mismo inventario ENTONCES 400.

### R2 — (RF-I10) La comparación es de solo lectura
CUANDO se compara, el sistema NO DEBE escribir nada (ni estados, ni
versiones, ni auditoría de mutación): la evaluación de daños es un
informe, no un cambio de estado.

### R3 — (RF-C3, C4/C6) Aislamiento y gobernanza
SI una petición de otro tenant compara inventarios ENTONCES 404 sin
revelar existencia. Roles: admin/empleado; sin token 401. Sin migraciones
nuevas: `TABLAS_PERMITIDAS` no cambia; `RUTAS_PERMITIDAS` (+1).

## DECISIONES de la puerta
| Id | Decisión |
|---|---|
| PA-21-1 | La comparación empareja por `plantilla_item_id` y, si falta, por nombre dentro de la misma zona; el resultado agrupa por zona |
| PA-21-2 | «Diferente» = respuesta o estado_checklist distinto; los comentarios van en el detalle, no cambian el veredicto |
