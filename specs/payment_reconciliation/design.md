# Design — payment_reconciliation

## 1. Tablas (migración `0025_payment_reconciliation.sql`)
- `payment_import`: id, tenant_id, nombre_archivo, hash_archivo (64),
  formato_detectado, mapeo_aplicado_json, cargado_por, fecha_carga,
  total_registros, conciliados, sin_identificar. RLS.
- `payment_record`: id, tenant_id, import_id FK, fecha_movimiento, valor
  numeric, referencia_texto, pagador_texto, cuenta_destino, medio_pago,
  estado CHECK (Cargado, Sugerido, Conciliado, Sin_identificar, Duplicado,
  Descartado), contract_id FK NULL, estrategia_conciliacion,
  confianza numeric, conciliado_por, fecha_conciliacion. RLS; índice
  (tenant, contract).
- `payment_mapping_profile`: id, tenant_id, nombre_origen, mapeo_columnas_json,
  activo. UNIQUE (tenant, nombre_origen). RLS.

## 2. Rutas (8)
| Método y ruta | Rol | R |
|---|---|---|
| POST /pagos/importaciones | admin/empleado | R1 |
| GET /pagos/importaciones | admin/empleado | R1 (historial) |
| POST /pagos/importaciones/:id/mapeo | admin/empleado | R2 |
| POST /pagos/importaciones/:id/procesar | admin/empleado | R3 |
| GET /pagos/importaciones/:id | admin/empleado | R4 (tres grupos) |
| PATCH /pagos/registros/:id | admin/empleado | R5 |
| GET /contratos/:id/referencia-pago | admin/empleado | R5 (RF-PA9) |
| GET /contratos/:id/estado-cuenta | admin/empleado (+inquilino scoped) | R6 |

## 3. Capas (§15.2)
1) Inferencia (PA-30-1: interfaz + MVP determinista por encabezados);
2) Modelo canónico (parseo determinista, PA-30-2); 3) Conciliación
(estrategias §15.4 combinadas, ninguna concilia sin humano — salvaguarda).

## 4. Errores
- `MapeoInvalidoError` (400) — columnas inexistentes en el archivo.
- `ImportacionYaProcesadaError` (409) — mismo hash o ya procesada.
- `ResourceNotFoundError` (404).

## 5. Archivos
Migración 0025, schemas (3), tipos `packages/types/src/pagos.ts`,
`modules/core/pagos/` (inferidor-estructura.ts interfaz+impl,
importaciones.{repository,service,controller}.ts), tests (parseo
determinista unit, idempotencia, emparejamiento, bandeja, seguridad,
RLS).
