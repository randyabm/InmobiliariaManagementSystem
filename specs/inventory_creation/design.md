# Design — inventory_creation

> Feature #12. Creación del inventario con fotos (RF-I1, RF-I3, RF-I7,
> RF-I13, RF-I24, §8.7). Materializa la plantilla de #11 como snapshot.

---

## 1. La materialización (R4, PA-12-3)

`POST /inventarios` en la transacción de la petición:

```
1. exigir propiedad (404 si ajena, #6)
2. plantilla = resolverPlantillaParaTenant(tipo de la propiedad, ctx)
   (copia TENANT si existe, si no SISTEMA — patrón PA-8-3)
3. INSERT inventario (BORRADOR, tipo_evento, creado_por)
4. INSERT inventario_zona ← zonas ACTIVAS de la plantilla
5. INSERT inventario_item ← ítems ACTIVOS de cada zona (snapshot)
```

Las filas copiadas guardan `plantilla_zona_id`/`plantilla_item_id` (origen)
pero su contenido es independiente: editar la plantilla después NO altera
el snapshot (RF-I24). El `estado_checklist` y `valor_respuesta` nacen NULL.

## 2. Módulo

`apps/api/src/modules/core/inventarios/` (depende de `clientes`,
`almacenamiento`, `plantillas`):

```
inventarios.module.ts
inventarios.{repository,service}.ts
inventarios.controller.ts
fotos.{service,controller}.ts        (R5)
dto/ (crear-inventario, crear-zona-inventario, crear-item-inventario,
      actualizar-item-inventario, reordenar)
errors/ (inventario-borrador-ya-existe)
__tests__/
```

`PlantillasService` gana `resolverPlantillaParaTenant(tipo, ctx)` (la
copia TENANT o la SISTEMA, como `buscarDefinicionParaTenant` de #7/#8).

## 3. Superficie HTTP (12 rutas)

| Método y ruta | R | Auditoría |
|---|---|---|
| `POST /inventarios` | R4 | `@Audit('crear','inventario')` |
| `GET /inventarios` | R7 (lista + filtros) | — |
| `GET /inventarios/:id` | R7 (ficha completa) | — |
| `POST /inventarios/:id/zonas` | R6 | `@Audit('crear','inventario_zona')` |
| `PATCH /inventarios/:id/zonas/:idZona` | R6 (nombre/orden) | `@Audit('actualizar','inventario_zona')` |
| `DELETE /inventarios/:id/zonas/:idZona` | R6 | `@Audit('baja','inventario_zona')` |
| `POST /inventarios/:id/zonas/:idZona/items` | R6 | `@Audit('crear','inventario_item')` |
| `PATCH /inventarios/:id/items/:idItem` | R6 (respuesta/comentario) | `@Audit('actualizar','inventario_item')` |
| `DELETE /inventarios/:id/items/:idItem` | R6 | `@Audit('baja','inventario_item')` |
| `POST /inventarios/:id/items/:idItem/fotos` | R5 | `@Audit('crear','inventario_item_foto')` |
| `DELETE /inventarios/:id/items/:idItem/fotos/:idFoto` | R5 | `@Audit('baja','inventario_item_foto')` |
| `PATCH /inventarios/:id/reordenar` | R6 | `@Audit('actualizar','inventario')` |

`Roles('admin','empleado')` en todas (R8). El `AuditInterceptor` ya tiene
los fallbacks `idItem`/`idZona` (de #11); falta `idFoto`.

## 4. Fotos (R3, R5, PA-12-4)

`FotosService` reutiliza `AlmacenamientoService.subir` (#6): clave
`uuid + extensión`, hash SHA-256, mime. La fila guarda clave/hash/autor/
fecha; el borrado es lógico (`activo = false` en la fila — la tabla lleva
`activo`); el objeto se conserva. `autor` = `EMPLEADO` (el inquilino podrá
adjuntar en #13, `INQUILINO`).

## 5. Migración (`0016_inventory_creation.sql`, R11)

Forward-only e idempotente: las 4 tablas con RLS ENABLE+FORCE y política
por `tenant_id`, CHECKs (tipo_evento, estado, field_type, estado_checklist,
autor), índices (`(tenant_id, propiedad_id, estado)`,
`(tenant_id, inventario_id)`, `(tenant_id, zona_id)`), `activo` en
`inventario_item_foto` (baja lógica).

## 6. Errores de dominio

| Error | `code` | HTTP | Cuándo |
|---|---|---|---|
| `InventarioBorradorYaExisteError` (nuevo) | `INVENTARIO_BORRADOR_YA_EXISTE` | 409 | R4 |
| `ResourceNotFoundError` (reutilizado) | `RESOURCE_NOT_FOUND` | 404 | R4, R8 |
| `SinContextoDeTenantError` (reutilizado) | `SIN_CONTEXTO_DE_TENANT` | 500 | R9 |

## 7. Alternativas descartadas

1. **Estado del inventario en el motor de workflows.** Descartada
   (PA-12-1): el ciclo del inventario ya está repartido entre #13/#14 y el
   motor no aporta nada que una columna con CHECK no dé para el MVP; si la
   negociación (RF-I6/#22) lo pidiera, migra sin romper (la columna queda).
2. **Fotos sin tabla (solo array en el ítem).** Descartada: §8.7 define la
   entidad `InventoryItemPhoto` con autor y hash; una tabla permite el
   autor `INQUILINO` (#13) y la trazabilidad.
3. **Editar la plantilla desde el inventario.** Descartada: RF-I24 lo
   prohíbe explícitamente (R6).

## 8. Estado de las ambigüedades

Las cuatro decisiones de la puerta (PA-12-1…PA-12-4) quedan explícitas. El
`valor_respuesta` jsonb guarda la respuesta del ítem según su `field_type`
(estado → `estado_checklist`; conteo/seleccion/si_no → `valor_respuesta`);
la interpretación detallada es de la UI (#15) y de #13. No quedan
ambigüedades de producto.
