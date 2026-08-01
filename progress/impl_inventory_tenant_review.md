# Implementación — feature #13 (`inventory_tenant_review`)

**Status:** implementación completa, a la espera del review. Suite: `npm run
test` **785** + `npm run test:db` **140**. Lint, typecheck y build verdes.

## Mapa de trazabilidad R1–R13 → test concreto

| R | Enunciado (resumen) | Test que lo cubre |
|---|---|---|
| R1 | Invitación: token 48 B, hash SHA-256, 72 h, 201 con URL | `invitaciones.api.test.ts` T16 (hash en SELECT, 64 hex) |
| R2 | BORRADOR → ENVIADO en la misma tx; 409 si no es BORRADOR | `invitaciones.api.test.ts` T16 (SELECT estado) y T16 (409 + 1 sola fila) |
| R3 | El link lleva a cuenta persistente, nunca acceso anónimo | `invitaciones.api.test.ts` T17 (bootstrap mínimo) + T18 (registro) |
| R4 | OTP: 6 dígitos, hash, 10 min, entrega por #10 | `invitaciones.api.test.ts` T18 (hash en `codigo_otp`, código en el outbox) |
| R5 | Verificar OTP: 401 uniforme, un solo uso | `invitaciones.api.test.ts` T18 (malo → 401; bueno → verificado_en) |
| R6 | Revisar ítem: ACEPTADO/OBJETADO, comentario obligatorio al objetar | `revision-inquilino.api.test.ts` T19 (400 sin comentario, SELECT 0 filas) |
| R7 | Todos los ítems revisados → `revision_completada_en` | `revision-inquilino.api.test.ts` T19 (SELECT NOT NULL) |
| R8 | OTP con propósito FIRMA listo para #14 | `revision-pii.api.test.ts` (solicitar/verificar con `FIRMA`) |
| R9 | Scoping: un inquilino solo ve/revisa SU inventario (404) | `revision-inquilino.api.test.ts` T20 (inquilino B → 404) |
| R10 | Sin contexto de tenant → 0 filas (el motor filtra) | `inventario-revision-rls.test.ts` T21 (conexión virgen) |
| R11 | Auditoría con entity_id y metadata vacío | `revision-pii.api.test.ts` T22 (SELECT de audit_log) |
| R12 | Tokens y códigos SOLO como hash; nunca en logs/auditoría | `revision-pii.api.test.ts` T22 (serializado sin PII) + T17 (401 uniforme) |
| R13 | Migración 0017 + TABLAS +3 + RUTAS +7 + 4ª función | `tests/migrations.test.ts` + `routes-surface.test.ts` + `migrations.db.test.ts` |

**Anclaje al PRD:** R1–R13 citan RF-I4, RF-I5, RF-AU2 (actualizado), RF-AU5,
RF-AU3, RF-C3, RF-C4, D2. Ningún requirement sin origen.

## Decisiones PA-13 ejecutadas (aprobadas en la puerta del spec)

| Id | Decisión | Dónde vive |
|---|---|---|
| PA-13-1 | Cuenta con contraseña + OTP (persistente) | `registro-invitacion.service.ts` (resolverIdentidad + bcrypt + rol) |
| PA-13-2 | Revisión de una sola ronda (UNIQUE ítem+perfil) | `0017_inventory_tenant_review.sql` + 400 por `23505` |
| PA-13-3 | OTP entregado por el motor de #10 | `otp.service.ts` / `registro-invitacion.service.ts` (outbox) |
| PA-13-4 | 4ª vía SECURITY DEFINER `invitacion_por_token` | `0017_inventory_tenant_review.sql` + GRANT en `rol-aplicacion.ts` |

## Fronteras anotadas (lo que #13 NO hace)

- **#14 `inventory_signature_pdf`:** la firma exige un OTP `FIRMA` recién
  verificado (R8) — la infraestructura quedó lista (`proposito: 'FIRMA'`).
- **#22:** la negociación multironda insertará `EN_NEGOCIACION → ACORDADO`
  entre la revisión completada y la firma.
- **#21:** la comparación entrada/salida.

## Notas de implementación

- `inventario.perfil_inquilino_id` (scoping R9) se añadió en la migración
  0017 y se asigna en `generar` (misma transacción que BORRADOR→ENVIADO).
- La revisión del inquilino es la primera feature con rutas de CLIENTE
  (`@Roles('inquilino')` + scoping por perfil en el servicio).
- `OtpService` se exporta para que #14 exija el OTP de FIRMA.
