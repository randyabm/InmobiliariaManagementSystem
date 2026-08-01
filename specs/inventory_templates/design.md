# Design — inventory_templates

> Feature #11. Plantillas de inmuebles (zonas e ítems, §8.8).
> Este documento asume `docs/architecture.md` y `docs/conventions.md`.

---

## 1. Origen: el molde del inventario

El PRD §8.8 distingue con énfasis **plantilla ≠ inventario**: la plantilla
es el molde, el inventario la instancia rellena. #11 construye el molde y
su gestión; #12 lo materializará como snapshot.

```
plantilla_inmueble (1) ──n plantilla_zona (1) ──n plantilla_item
    tipo, origen                 repetible, obligatoria    field_type, opciones,
    UNIQUE(tenant_id, tipo)      UNIQUE(plantilla_id, nombre)  banderas
                                                                 UNIQUE(zona_id, nombre)
```

## 2. El patrón de plantillas del sistema (PA-11-1)

Reutiliza EXACTAMENTE el patrón de #7 (workflow_definicion): las plantillas
base viven en la misma tabla con el tenant reservado
`00000000-0000-0000-0000-000000000000`, la política RLS de
`plantilla_inmueble` es `USING (tenant_id = contexto OR tenant_id =
reservado AND contexto presente) WITH CHECK (tenant_id = contexto)`, y las
políticas de zona/ítem son por subconsulta a la plantilla con `WITH CHECK`
propio (nadie INSERTA filas contra plantillas del sistema). El test del
inventario de funciones SECURITY DEFINER no cambia (no hay vía nueva).

## 3. El catálogo base (R4, PA-11-2)

La migración siembra (idempotente, `IF NOT EXISTS` por tipo):

- **APARTAMENTO** con el ejemplo completo del PRD §8.8.5: Sala (obligatoria)
  con Paredes/Piso/Techo/Ventanas/Iluminación; Cocina (obligatoria) con
  Mesón/Estufa/Lavaplatos/Electrodomésticos; Habitación (**repetible**) con
  Paredes/Clóset/Piso; Baño (**repetible**) con Sanitario/Ducha/Grifería;
  Entrega de llaves (obligatoria) con sus ítems de `conteo`. Los
  `field_type` y banderas siguen el ejemplo literal.
- **CASA, LOCAL, OFICINA, BODEGA, PARQUEADERO** como plantillas SISTEMA sin
  zonas: el PRD dice «siguen el mismo modelo con sus zonas propias» sin
  enumerarlas; inventarlas sería inventar producto. El tenant las clona y
  completa (RF-I22).

## 4. Superficie HTTP (9 rutas)

| Método y ruta | Rol | R | Auditoría |
|---|---|---|---|
| `GET /plantillas` | admin/empleado | R11 (lista) | — |
| `GET /plantillas/:id` | admin/empleado | R10 (completa) | — |
| `POST /plantillas/:id/clonar` | **admin** | R5 | `@Audit('crear','plantilla_inmueble')` |
| `POST /plantillas/:id/zonas` | **admin** | R7 | `@Audit('crear','plantilla_zona')` |
| `PATCH /plantillas/:id/zonas/:idZona` | **admin** | R7 | `@Audit('actualizar','plantilla_zona')` |
| `DELETE /plantillas/:id/zonas/:idZona` | **admin** | R7 | `@Audit('baja','plantilla_zona')` |
| `POST /plantillas/:id/zonas/:idZona/items` | **admin** | R8, R9 | `@Audit('crear','plantilla_item')` |
| `PATCH /plantillas/:id/zonas/:idZona/items/:idItem` | **admin** | R8, R9 | `@Audit('actualizar','plantilla_item')` |
| `DELETE /plantillas/:id/zonas/:idZona/items/:idItem` | **admin** | R8 | `@Audit('baja','plantilla_item')` |

El `AuditInterceptor` necesita los fallbacks `idZona` e `idItem` en la
resolución de `entity_id` (las bajas lógicas de rutas anidadas; el patrón
ya ampliado en #25/#6/#7).

Firmas nuevas relevantes:

```ts
// plantillas.service.ts
listar(ctx): Promise<PlantillaInmueble[]>;
obtener(id, ctx): Promise<PlantillaCompleta>;          // zonas + ítems activos
clonar(id, ctx): Promise<PlantillaInmueble>;           // R5
crearZona(plantillaId, dto, ctx): Promise<PlantillaZona>;
actualizarZona(idZona, dto, ctx): Promise<PlantillaZona>;
darDeBajaZona(idZona, ctx): Promise<void>;
crearItem(zonaId, dto, ctx): Promise<PlantillaItem>;
actualizarItem(idItem, dto, ctx): Promise<PlantillaItem>;
darDeBajaItem(idItem, ctx): Promise<void>;
```

## 5. Gestión (R6, R7, R8, R9)

- `exigirEditable(plantillaId)`: 404 si ajena/inexistente; 409
  `PLANTILLA_SISTEMA_NO_EDITABLE` si `origen = 'SISTEMA'` (R6).
- Las mutaciones de zonas/ítems validan la pertenencia por la plantilla de
  la ruta (la zona debe colgar de `:id`, el ítem de `:idZona`) → 404 si no.
- `opciones_json`: validación zod en el borde (solo con `seleccion` y no
  vacío) + CHECK en el motor (R9). El DTO de ítem: `field_type` del enum y
  `opciones_json` opcional; el servicio rechaza la combinación inválida
  antes de insertar.
- Baja lógica de zona: los ítems quedan `activo` pero la zona inactiva no
  se lista (R7) — la copia de #12 solo tomará zonas activas.

## 6. Migración (`0015_inventory_templates.sql`, R14)

Forward-only e idempotente: las tres tablas con RLS ENABLE+FORCE (la de
`plantilla_inmueble` con el OR del sistema y `WITH CHECK`; las de zona/ítem
por subconsulta con `WITH CHECK` propio), CHECKs (tipo, origen, field_type,
opciones coherente con seleccion), UNIQUEs, el seed del catálogo y el
tenant reservado (ya existe desde 0013).

## 7. Errores de dominio

| Error | `code` | HTTP | Cuándo |
|---|---|---|---|
| `PlantillaSistemaNoEditableError` (nuevo) | `PLANTILLA_SISTEMA_NO_EDITABLE` | 409 | R6 |
| `ResourceNotFoundError` (reutilizado) | `RESOURCE_NOT_FOUND` | 404 | R5, R6, R11 |
| `SinContextoDeTenantError` (reutilizado) | `SIN_CONTEXTO_DE_TENANT` | 500 | R12 |
| BadRequest (pipe zod) | `BAD_REQUEST` | 400 | R9 |

## 8. Archivos

### Se crean

```
apps/api/drizzle/0015_inventory_templates.sql
apps/api/src/database/schema/{plantilla-inmueble,plantilla-zona,plantilla-item}.ts
apps/api/src/modules/core/plantillas/
├── plantillas.module.ts
├── plantillas.{repository,service}.ts
├── plantillas.controller.ts
├── dto/ (crear-zona, actualizar-zona, crear-item, actualizar-item)
├── errors/ (plantilla-sistema-no-editable)
└── __tests__/
apps/api/src/database/__tests__/plantillas-rls.test.ts
packages/types/src/plantillas.ts
```

### Se modifican

```
apps/api/src/database/schema/index.ts
apps/api/drizzle/meta/_journal.json
tests/migrations.test.ts                    (TABLAS_PERMITIDAS +3)
apps/api/src/modules/core/__tests__/routes-surface.test.ts  (RUTAS_PERMITIDAS +9)
apps/api/test/db/migrations.db.test.ts       (tablas, RLS, seed)
apps/api/src/modules/core/audit/audit.interceptor.ts        (fallbacks idZona/idItem)
apps/api/src/modules/core/core.module.ts     (registra PlantillasModule)
packages/types/src/index.ts
feature_list.json                            (#11 → spec_ready)
```

## 9. Alternativas descartadas

1. **Tabla global para las plantillas base sin RLS.** Descartada: rompe la
   convención; el patrón de #7 ya resuelve el caso (PA-11-1).
2. **Seed completo de las seis plantillas.** Descartada (PA-11-2): el PRD
   solo enumera el Apartamento; inventar las zonas de las otras cinco sería
   inventar producto.
3. **Materializar en #11 (crear zonas/ítems de inventario al editar).**
   Descartada: es exactamente la frontera §8.8 nivel 3 / RF-I24 → #12.
4. **Un árbol genérico (zonas de zonas).** Descartada: §8.8.1 fija dos
   niveles — zona → ítem.

## 10. Estado de las ambigüedades

Las cuatro decisiones de la puerta (PA-11-1…PA-11-4) quedan explícitas. El
catálogo de las cinco plantillas sin enumerar se resuelve con «sin zonas»
hasta que el humano las defina (anotado en R4). No quedan más
ambigüedades de producto.
