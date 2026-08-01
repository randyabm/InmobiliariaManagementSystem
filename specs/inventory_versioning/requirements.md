# Requirements — inventory_versioning

> Feature #22. Versionado del inventario ante cada ronda de negociación
> (RF-I6, §8.7: EN_NEGOCIACION entre la revisión y el acuerdo).

### R1 — (RF-I6) Abrir la negociación versionando el inventario
CUANDO un usuario con rol `admin` o `empleado` invoca `POST
/inventarios/:id/negociar`, el sistema DEBE crear una VERSIÓN del snapshot
del inventario (`inventario_version` con `snapshot_json` de zonas/ítems/
respuestas, `version` correlativa y `creado_por`), transicionar de
`ENVIADO`/`EN_REVISION` a `EN_NEGOCIACION` y DEBE responder 201 con la
versión. SI el inventario no está en estado revisable ENTONCES 409 sin
cambiar nada.

### R2 — (RF-I6) Cada ronda crea una versión nueva
CUANDO se vuelve a invocar `POST /inventarios/:id/negociar` en
`EN_NEGOCIACION`, el sistema DEBE crear la versión siguiente (2, 3, …)
con el snapshot ACTUAL y mantenerse en `EN_NEGOCIACION`.

### R3 — (RF-I6, #14) Cerrar la negociación hacia el acuerdo
CUANDO un usuario con rol `admin` o `empleado` invoca `POST
/inventarios/:id/confirmar-acuerdo` en `EN_NEGOCIACION`, el sistema DEBE
transicionar a `ACORDADO` SI la revisión está completa (comportamiento de
#14 ampliado). `confirmar-acuerdo` en `ENVIADO`/`EN_REVISION` sigue
funcionando.

### R4 — (RF-I6, RF-C3) Historial y aislamiento
CUANDO un usuario con rol `admin` o `empleado` invoca `GET
/inventarios/:id/versiones`, el sistema DEBE responder el historial
ordenado de versiones (versión, creado_por, created_at, resumen de
cambios). SI la petición es de otro tenant ENTONCES 404; roles y 401 como
siempre.

### R5 — (C4/C6) Migración versionada
EL sistema DEBE crear `inventario_version` en una única migración (RLS
ENABLE+FORCE, `UNIQUE (inventario_id, version)`), con `TABLAS_PERMITIDAS`
(+1) y `RUTAS_PERMITIDAS` (+2) actualizadas en el mismo cambio.

## DECISIONES de la puerta
| Id | Decisión |
|---|---|
| PA-22-1 | `snapshot_json` = zonas/ítems ACTIVOS con sus respuestas (sin fotos binarias: solo claves) — suficiente para reconstruir y comparar |
| PA-22-2 | La negociación multironda es manual (cada ronda = una versión); el límite de rondas se deja a la política de la inmobiliaria |
