# Design — insurance_policy

## 1. Tabla (migración `0023_insurance_policy.sql`)
insurance_policy: id, tenant_id, property_id FK, contract_id FK NULL,
aseguradora, numero_poliza NULL, vigencia_desde NULL, vigencia_hasta NULL,
valor_cobertura numeric NULL, estado CHECK (en_estudio, aprobada,
rechazada), observaciones NULL, created_at, updated_at. RLS ENABLE+FORCE;
índice (tenant, property).

## 2. Rutas (4)
| Método y ruta | Rol | R |
|---|---|---|
| POST /propiedades/:id/polizas | admin/empleado | R1 |
| GET /propiedades/:id/polizas | admin/empleado | R3 |
| GET /polizas/:id | admin/empleado | R3 |
| PATCH /polizas/:id | admin/empleado | R2 |
| POST /polizas/:id/documento | admin/empleado | R2 |

## 3. Archivos
Migración 0023, schema insurance-policy.ts, tipos, polizas.{repository,
service,controller}.ts, tests (crear, aprobar con documento, aislamiento,
migraciones).
