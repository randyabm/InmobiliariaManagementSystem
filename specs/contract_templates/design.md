# Design — contract_templates

> Feature #16. Plantillas de contrato (RF-CT1, RF-CT2, §13.2).

## 1. Tabla `contract_template`

```
contract_template: id, tenant_id, property_id (NULL = base del tenant),
nombre, cuerpo (text), merge_fields_json (jsonb), version (int, default 1),
validado_por (uuid NULL), estado CHECK (borrador, validado),
created_at, updated_at. RLS por tenant (ENABLE+FORCE).
Índices: UNIQUE (tenant_id) WHERE property_id IS NULL; UNIQUE
(tenant_id, property_id).
```

## 2. Rutas (6)

| Método y ruta | Rol | R |
|---|---|---|
| `GET /plantillas-contrato` | admin/empleado | R1 (404 si no existe) |
| `POST /plantillas-contrato` | admin/empleado | R1 (409 si ya existe base) |
| `PATCH /plantillas-contrato` | admin/empleado | R2 (editar, version++ si validada) |
| `POST /plantillas-contrato/validar` | admin | R2 (validado_por = actor) |
| `POST /propiedades/:id/contrato/plantilla` | admin/empleado | R3 (copia base + campos de propiedad) |
| `POST /propiedades/:id/contrato/plantilla/validar` | admin | R4 |

`GET /propiedades/:id/contrato/plantilla` (R3, 404 si no existe) → 7ª ruta.

## 3. Errores de dominio
- `PlantillaContratoYaExisteError` (409) — base duplicada / copia duplicada.
- `PlantillaContratoInvalidaError` (400) — merge fields inválidos (PA-16-2:
  `{campo}` del cuerpo debe existir en `merge_fields_json`).
- `ResourceNotFoundError` (404) — ajena o inexistente.

## 4. Archivos
Migración `0019_contract_templates.sql`, schema `contract-template.ts`,
`modules/core/contratos/` (plantillas.controller/service/repository),
`packages/types/src/contratos.ts`, tests (`plantillas-contrato.api.test.ts`,
unit de la validación de merge fields, RLS en `migrations.db.test.ts`).
