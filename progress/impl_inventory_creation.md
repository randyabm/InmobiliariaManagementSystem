# Implementación — feature #12 (`inventory_creation`)

**Status:** implementación completa, a la espera del review. Suite: `npm run
test` **746** (82 archivos) + `npm run test:db` **131** (3 archivos). Lint,
typecheck y build verdes.

## Mapa de trazabilidad R1–R11 → test concreto

| R | Enunciado (resumen) | Test que lo cubre |
|---|---|---|
| R1 | Alta del inventario en `BORRADOR` con la plantilla materializada | `inventarios.api.test.ts` T12 (201, snapshot completo, `creado_por`) |
| R2 | Zonas e ítems del snapshot (copiados, `plantilla_*_id`) | `inventarios.api.test.ts` T12 (zonas e ítems esperados de APARTAMENTO) |
| R3 | Fotos: fila con clave/hash/`autor`; binario en MinIO | `inventarios.api.test.ts` T14 (SELECT + `getObject` real) |
| R4 | Materialización de la plantilla vigente (TENANT o SISTEMA, PA-12-3) | `inventarios.api.test.ts` T12 + unit `inventarios.service.test.ts` T21 |
| R5 | Baja lógica del borrador (jamás DELETE, `activo = false`) | `inventarios.api.test.ts` T15 (404 tras baja) |
| R6 | Reordenar zonas como lista | `inventarios.api.test.ts` T13 (SELECT del orden final) |
| R7 | Edición solo en `BORRADOR` (409 fuera de él, nada escrito) | `inventarios.api.test.ts` T15 (estado a mano → PATCH 409 + SELECT) |
| R8 | Responder ítem (estado_checklist, valor_respuesta, comentario) | `inventarios.api.test.ts` T13 (+400 enum inválido) |
| R9 | Listado con filtros y ficha completa | `inventarios.api.test.ts` T12 |
| R10 | Baja lógica de foto: fila muerta, objeto conservado | `inventarios.api.test.ts` T14 (`getObject` tras baja) |
| R11 | Aislamiento 404/409, RBAC 403/401, auditoría y PII | `inventarios-seguridad.api.test.ts` T18/T19/T20 + `inventarios-rls.test.ts` T17 |

**Anclaje al PRD:** R1–R11 citan RF-I1, RF-I3, RF-I7, RF-I24, §8.7/8.8,
RF-C3, D2. Ningún requirement sin origen.

## Decisiones PA-12 ejecutadas (aprobadas en la puerta del spec)

| Id | Decisión | Dónde vive |
|---|---|---|
| PA-12-1 | Estado en COLUMNA con CHECK (no workflow): transiciones en #13/#14 | `0016_inventory_creation.sql` (`inventario_estado_check`) |
| PA-12-2 | Un borrador por propiedad+tipo_evento → 409 | `inventarios.service.ts` `crear` + `InventarioBorradorYaExisteError` |
| PA-12-3 | Plantilla activa: copia TENANT, si no la SISTEMA | `plantillas.service.ts` `resolverPlantillaParaTenant` |
| PA-12-4 | Baja de foto lógica; el objeto se conserva | `inventarios.service.ts` `eliminarFoto` + T14 |

## Fronteras anotadas (lo que #12 NO hace)

- **#13 `inventory_tenant_review`:** las transiciones fuera de `BORRADOR`
  (ENVIADO → EN_REVISION), el OTP y el scoping del inquilino.
- **#14 `inventory_signature_pdf`:** ACORDADO → FIRMADO → CERRADO y el PDF.
- **#21/#22:** comparación de inventarios y negociación multironda
  (insertará `EN_NEGOCIACION → ACORDADO` entre medias).
- **#15 `pwa_offline`:** `creado_offline`/`sincronizado_en` ya existen en
  la tabla para no tocar la migración después.

## Notas de implementación

- El rol de aplicación **nunca hace DELETE** (`rol-aplicacion.ts`, «Nunca
  borrar»): el borrado del borrador es baja lógica en cascada
  (`bajaLogicaCompleta`), no DELETE físico.
- El test de frontera de #25 (`codeudores.test.ts`, R17) se actualizó: las
  tablas `inventario*` ya existen, el invariante ahora verifica que ninguna
  FK de codeudores/referencias las exija.
- `AlmacenamientoService.obtener` (descarga de binario) se añadió para
  #14, que la necesita para verificar el hash del PDF firmado.
