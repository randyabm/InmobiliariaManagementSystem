# Design — contract_digitization

> Feature #18 (RF-CT6/7, §13.4).

## 1. Tabla `contract_document` (migración `0021`)

id, tenant_id, contract_id FK, nombre, origen CHECK (generado,
digitalizado), clave_storage, hash_sha256 (64), mime, tamano_bytes,
metadatos jsonb NULL, created_at. RLS ENABLE+FORCE; índice
(tenant, contract).

## 2. Rutas (4)

| Método y ruta | Rol | R |
|---|---|---|
| `POST /contratos/digitalizados` | admin/empleado | R1 |
| `GET /contratos/:id/documentos` | admin/empleado | R2 |
| `GET /propiedades/:id/contratos/documentos` | admin/empleado | R2 |
| `GET /contratos/:id/documentos/:idDocumento/pdf` | admin/empleado | R3 |

## 3. Errores
- `ResourceNotFoundError` (404) — propiedad/contrato ajeno.
- `BadRequestException` (400) — sin archivo o metadatos inválidos.

## 4. Archivos
Migración `0021`, schema `contract-document.ts`, tipos `ContratoDocumento`,
`contratos/digitalizacion.{service,controller}.ts` (en ContratosModule),
tests (subida con SELECT + hash, listado, descarga con verificación,
seguridad).
