# Design — inventory_versioning

## 1. Tabla (migración 0024)
inventario_version: id, tenant_id, inventario_id, version, snapshot_json,
creado_por, created_at. UNIQUE (inventario_id, version). RLS ENABLE+FORCE.

## 2. Rutas (2)
POST /inventarios/:id/negociar (versión correlativa + EN_NEGOCIACION;
409 fuera de ENVIADO/EN_REVISION/EN_NEGOCIACION) · GET
/inventarios/:id/versiones.

## 3. Snapshot (PA-22-1)
Zonas/ítems ACTIVOS con respuestas; fotos solo claves. `confirmar-acuerdo`
de #14 acepta EN_NEGOCIACION (R3).
