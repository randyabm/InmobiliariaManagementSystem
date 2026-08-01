# Implementación — feature #6 (`property_profile`)

**Status:** implementación completa, a la espera del review. Suite: `npm run
test` **575** (56 archivos) + `npm run test:db` **100** (3 archivos). Lint,
typecheck y build verdes.

## Mapa de trazabilidad R1–R22 → test concreto

| R | Enunciado (resumen) | Test que lo cubre |
|---|---|---|
| R1 | Tabla `propiedad` con los 4 grupos + CHECKs + RLS | `migrations.db.test.ts` (RLS, CHECKs, FKs) + `propiedades-rls.test.ts` |
| R2 | Tabla `propiedad_propietario` con UNIQUE + RLS | `migrations.db.test.ts` + `propiedades-anexos.api.test.ts` (idempotencia) |
| R3 | Tabla `historial_ocupacion` con índice parcial vigente | `migrations.db.test.ts` (índice parcial) + `propiedades-anexos.api.test.ts` |
| R4 | Tabla `propiedad_documento` con UNIQUE de clave + RLS | `migrations.db.test.ts` (UNIQUE clave_storage) |
| R5 | `POST /propiedades` 201; principal inexistente/ajeno → 404 | `propiedades.api.test.ts` T11 |
| R6 | Ficha con propietarios, cuenta de giro e inquilino actual | `propiedades.api.test.ts` «la ficha expone…» |
| R7 | PATCH parcial y DELETE baja lógica (SELECT `activo`) | `propiedades.api.test.ts` T11 |
| R8 | Override validado con `resolverCuentaDeGiro` (#5); ajeno → 400; ficha con `cuenta_giro` resuelta/nullable | `propiedades.api.test.ts` T12 + `propiedades.service.test.ts` T25 |
| R9 | Cantidades como cadenas exactas | `propiedades.api.test.ts` (typeof string, `'120.00'`) |
| R10 | Añadir/remover propietarios; principal → 409 | `propiedades-anexos.api.test.ts` (idempotencia, 409, baja lógica) |
| R11 | Asignar inquilino actual cierra/abre líneas en una transacción | `propiedades-anexos.api.test.ts` (SELECT de `hasta`) |
| R12 | Historial ordenado por `desde` desc con nombre | `propiedades-anexos.api.test.ts` |
| R13 | Subir documento a MinIO + fila con hash | `propiedades-anexos.api.test.ts` (hash coincidente) |
| R14 | 404 indistinguible cross-tenant (4 tablas) | `propiedades-rls.test.ts` + `propiedades-seguridad.api.test.ts` T20 |
| R15 | PII/binarios fuera de logs y auditoría | `propiedades-seguridad.api.test.ts` T23 |
| R16 | Listar activos y archivar (baja lógica, objeto intacto) | `propiedades-anexos.api.test.ts` |
| R17 | Fotos: subir añade clave; clave ajena → 400 | `propiedades-anexos.api.test.ts` |
| R18 | `propietario`/`inquilino` → 403 en las 14 rutas; sin token → 401 | `propiedades-seguridad.api.test.ts` T21 |
| R19 | Sin contexto de tenant falla | `propiedades-rls.test.ts` (GUC virgen → 0 filas) |
| R20 | Auditoría de las mutaciones (una fila exacta) | `propiedades-seguridad.api.test.ts` T22 |
| R21 | Hash SHA-256 verificado contra el objeto almacenado | `almacenamiento.test.ts` + `propiedades-anexos.api.test.ts` |
| R22 | Migración única + TABLAS_PERMITIDAS + RUTAS_PERMITIDAS (14) | `tests/migrations.test.ts` + `routes-surface.test.ts` |

**Anclaje al PRD:** R1–R22 citan RF-P1, RF-P2, RF-P3, RF-C5, RF-C6
(frontera), RF-W4, §11.3, D2, §8.7 y §12.1/§13.4 (fronteras). Ningún
requirement sin origen.

## Decisiones PA-6 ejecutadas (aprobadas en la puerta del spec)

- **PA-6-1 — MinIO dentro de #6:** módulo `core/almacenamiento/`
  (`AlmacenamientoService`, deps `minio` + `@testcontainers/minio`),
  probado contra MinIO real (Testcontainers). Fotos y repositorio
  documental suben de verdad; las claves son `uuid + extensión derivada del
  mime` (el nombre del cliente nunca es clave, R15).
- **PA-6-2 — Principal obligatorio + puente:** `propiedad_propietario` para
  adicionales; el giro se resuelve contra el principal; duplicar/remover el
  principal → 409.
- **PA-6-3 — Fronteras respetadas:** sin `estado` (será #8) y sin creación
  en línea (será #9): el principal inexistente/ajeno es 404 puro.

## Dependencias cerradas

- **#5 (design.md §6):** `propiedad.cuenta_bancaria_id` existe, el override
  se valida con `resolverCuentaDeGiro` (regla única, no duplicada) y el
  test de integración «override gana / ajeno → 400 / sin cuenta → null» se
  hace A TRAVÉS de la propiedad (T12).
- **#5 R12 / D-1:** `GET /propietarios/:id` sigue sin `propiedades` (el
  contrato no se tocó); la lista con estado llegará con #8.
- **#25 R5:** la ficha no lleva columnas de retención.

## Desviaciones anotadas (todas en el spec o menores)

1. **El parámetro de ruta de propietarios/documentos se normalizó a
   `:idPropiedad`** en las rutas de colección (design.md mezclaba `:id` y
   `:idPropiedad`, mismo caso que #25). Cosmético; `routes-surface.test.ts`
   exige una forma canónica.
2. **`AuditInterceptor` ampliado** con `idPropietario` e `idDocumento` en el
   fallback de `entity_id` (bajas de rutas anidadas): sin ello, la baja de
   una asociación o un documento auditaría el id del recurso raíz.
3. **La sonda de ruta inexistente** de `routes-surface.test.ts` cambió de
   `/propiedades/secretas` a `/no-existe/secretas`: desde #6,
   `/propiedades/secretas` es un `GET /propiedades/:id` legítimo (401 sin
   token).
4. **MinIO en el arnés de tests de #6:** los tests que suben documentos o
   fotos levantan un contenedor MinIO y fijan `MINIO_*` ANTES de crear la
   app (`AlmacenamientoService` los lee al construirse).

## Candidatas a mutación (para el reviewer)

1. Quitar la validación del override en `crear` → rompe T12 (ajeno → 400)
   y el unit T25 (resolver no llamado).
2. `cuentaDeGiroNullable` sin catch (propaga el 400 a la ficha) → rompe
   «sin ninguna cuenta del principal, la ficha expone cuenta_giro null».
3. `asignarInquilinoActual` sin cerrar la línea vigente → rompe T17
   (reasignación: 2 líneas, primera con `hasta`).
4. Quitar el `WHERE hasta IS NULL` del UPDATE de cierre → rompe
   `historial_ocupacion` (dos vigentes) y el test de reasignación.
5. `remover` sin la guarda del principal (409) → rompe el test del
   principal y el de duplicado (idempotencia 409).
6. `DocumentosService.subir` guardando el binario en la fila (o sin hash) →
   rompe T18 (hash contra el objeto) y T23 (PII).
7. `FotosService.quitar` sin verificar pertenencia → rompe el 400 de clave
   ajena.
8. Quitar las políticas RLS de la migración 0012 → rompe
   `propiedades-rls.test.ts` (SELECT* → 0 filas).
