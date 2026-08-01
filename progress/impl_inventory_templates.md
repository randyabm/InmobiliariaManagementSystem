# Implementación — feature #11 (`inventory_templates`)

**Status:** implementación completa, a la espera del review. Suite: `npm run
test` **732** (80 archivos) + `npm run test:db` **122** (3 archivos). Lint,
typecheck y build verdes.

## Mapa de trazabilidad R1–R15 → test concreto

| R | Enunciado (resumen) | Test que lo cubre |
|---|---|---|
| R1 | Tabla `plantilla_inmueble` + RLS (patrón #7) | `migrations.db.test.ts` + `plantillas-rls.test.ts` |
| R2 | Tabla `plantilla_zona` (repetible/obligatoria/orden) | `migrations.db.test.ts` + `plantillas.api.test.ts` T12 |
| R3 | Tabla `plantilla_item` (field_type, opciones, banderas) | `migrations.db.test.ts` (CHECK opciones) + `plantillas.api.test.ts` T13 |
| R4 | Seed: 6 plantillas base, APARTAMENTO completo | `migrations.db.test.ts` + `plantillas.api.test.ts` T10 |
| R5 | Clonar (404 ajena, 409 tipo duplicado, copia activos) | `plantillas.api.test.ts` T11 + `plantillas.service.test.ts` T19 |
| R6 | La del sistema no se edita (409) | `plantillas.api.test.ts` T11 (SELECT: nada escrito) + unit T19 |
| R7 | CRUD de zonas con baja lógica | `plantillas.api.test.ts` T12/T14 |
| R8 | CRUD de ítems con field_type | `plantillas.api.test.ts` T13 |
| R9 | opciones_json solo con seleccion (400) | `plantillas.api.test.ts` T13 + unit T19 + CHECK del motor |
| R10 | Exponer banderas y zonas activas | `plantillas.api.test.ts` T10/T14 |
| R11 | Aislamiento 404/403/401 | `plantillas-seguridad.api.test.ts` T16/T17 + `plantillas-rls.test.ts` |
| R12 | Sin contexto falla | `plantillas-rls.test.ts` (virgen → 0 filas) |
| R13 | Auditoría de mutaciones | `plantillas-seguridad.api.test.ts` T18 |
| R14 | Migración 0015 + TABLAS +3 + RUTAS +9 | `tests/migrations.test.ts` + `routes-surface.test.ts` |
| R15 | Materialización anclada a #12 | anotado en el spec (sin código) |

**Anclaje al PRD:** R1–R15 citan RF-I2, RF-I22, RF-I23, RF-I24 (frontera),
§8.8, D2, RF-C3. Ningún requirement sin origen.

## Decisiones PA-11 ejecutadas (aprobadas en la puerta del spec)

- **PA-11-1 — Plantillas del sistema con tenant reservado:** el patrón de #7
  reutilizado tal cual (RLS con OR + `WITH CHECK` propio; zona/ítem por
  subconsulta con `WITH CHECK`). Verificado en `plantillas-rls.test.ts`
  (lectura del sistema, INSERT rechazado en los tres niveles) y en
  `migrations.db.test.ts` (la política).
- **PA-11-2 — Seed parcial:** APARTAMENTO con el ejemplo completo del PRD
  §8.8.5; las otras cinco sin zonas (el tenant las completa al clonar).
  Verificado con SELECTs en `migrations.db.test.ts`.
- **PA-11-3 — Materialización fuera:** la frontera queda anclada en el spec
  (R15); #12 copiará la plantilla como snapshot.
- **PA-11-4 — Gestión solo admin:** clonar/zonas/ítems `@Roles('admin')`;
  lectura admin/empleado (T17).

## Desviaciones anotadas (todas en el spec o menores)

1. **`validarOpciones` del servicio usa `BadRequestException`** (400, R9):
  la coherencia opciones↔seleccion se valida en el borde con zod
  (`superRefine`) y el servicio la refuerza; el CHECK del motor es la
  tercera barrera.
2. **`clonar` usa `buscarCompleta`** (solo zonas/ítems activos) como origen
  y `copiarPlantilla` copia explícitamente `activo = true` — las zonas
  inactivas nunca se clonan (R5).
3. **`AuditInterceptor` ampliado** con `idZona`/`idItem` para las bajas de
  rutas anidadas (patrón ya consolidado).

## Candidatas a mutación (para el reviewer)

1. Quitar el `activo = true` de `copiarPlantilla` → rompe T11 (la copia
  incluiría zonas inactivas — verificable con SELECT).
2. `exigirEditable` sin el caso SISTEMA (solo 404) → rompe T11 (409
  esperado) y el unit.
3. `validarOpciones` sin el chequeo (o con 409) → rompe T13 (400) y el
  unit.
4. Quitar el OR del sistema de la política de `plantilla_inmueble` → rompe
  `plantillas-rls.test.ts` (lectura del catálogo) y T10.
5. Quitar el `WITH CHECK` de zona/ítem → rompe `plantillas-rls.test.ts`
  (INSERT contra la del sistema aceptado).
6. `actualizarZona` devolviendo la zona sin re-leer (datos no aplicados) →
  rompe T12 (SELECT verifica la persistencia).
