# Design — contract_generation_signature

> Feature #17. Merge del template y firma (RF-CT3/4/5, RF-I12).

## 1. Tablas (migración `0020_contract_generation_signature.sql`)

- `contract`: id, tenant_id, property_id FK, inquilino_id FK
  (perfil_inquilino), propietario_id FK (perfil_propietario), fecha_inicio,
  fecha_fin, estado CHECK (vigente, firmado), created_at, updated_at.
  RLS ENABLE+FORCE; índice (tenant, property).
- `contrato_firma`: id, tenant_id, contract_id FK, firmante_tipo CHECK
  (EMPLEADO, INQUILINO), firmante_user_id FK, hash_documento (64),
  ip, otp_verificado_en, created_at. Append-only (triggers como #14),
  UNIQUE (contract_id, firmante_tipo). RLS.

## 2. Rutas (7)

| Método y ruta | Rol | R |
|---|---|---|
| `POST /propiedades/:id/contratos` | admin/empleado | R1, R2 |
| `GET /contratos` (filtro propiedad_id) | admin/empleado | R4 |
| `GET /contratos/:id` | admin/empleado (+inquilino del contrato) | R4, R6 |
| `POST /contratos/:id/firmas/empleado` | admin/empleado | R3 |
| `POST /contratos/:id/firmas/inquilino` | inquilino (scoping) | R3, R5 |
| `GET /contratos/:id/pdf` | admin/empleado | R6 |
| `GET /propiedades/:id/contratos` (historial) | admin/empleado | R4 |

## 3. Merge (R1, PA-17-1)

Cuerpo del template con `{campo}` reemplazado por:
- campos del inquilino: nombre, documento, email, celular;
- campos de la propiedad: dirección, canon, administración, cuenta;
- fechas: `{fecha_inicio}`, `{fecha_fin}` (ISO local).
Si queda un `{campo}` sin valor → 400 (PA-16-2 heredada).

## 4. Errores de dominio
- `ContratoNoGenerableError` (409) — template no validado / ya existe
  contrato vigente para la propiedad.
- `DocumentoNoFirmableError` (409, reutilizado de #14) — estado ≠ vigente,
  re-firma, hash ajeno.
- `FirmaSinOtpError` (401, reutilizado) — R5.
- `ResourceNotFoundError` (404).

## 5. Archivos
Migración `0020`, schemas `contract.ts`/`contrato-firma.ts`, tipos
`packages/types/src/contratos.ts` (+), `contratos/contratos.{repository,
service,controller}.ts`, reutiliza `GeneradorPdfPdfLib` (#14) y
`OtpService` (#13), tests (generación+firma API, seguridad, RLS,
append-only).
