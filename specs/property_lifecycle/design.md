# Design — property_lifecycle

> Feature #8. Ciclo de vida de la propiedad y dashboard (RF-P4, RF-P5,
> RF-PI4..PI6). Cierra la frontera PA-6-3 que dejó la #6.
> Este documento asume `docs/architecture.md` y `docs/conventions.md`.

---

## 1. Origen: lo que #6 dejó preparado

La #6 documentó en su spec y en `propiedades.service.ts` la frontera: «la
ficha queda lista para que #8 añada el estado». Este spec la cierra **sin
esquema nuevo** (PA-8-1): el estado ya vive en las tablas del motor (#7) —
`workflow_instancia.estado_actual_id`, `workflow_estado.clave/etiqueta`,
`workflow_instancia.updated_at` (tiempo en estado) y el log append-only.

```
propiedad (ficha, #6)                     motor (#7)
┌──────────────────────┐     entidad     ┌──────────────────────────────┐
│ sin columna estado   │ ──tipo/id──────▶│ workflow_instancia           │
│ (PA-8-1: no duplica) │  instancia      │  estado_actual_id → estado   │
└──────────────────────┘  (R1)           │  updated_at → tiempo (R11)   │
                                         │  log append-only (R7)        │
                                         └──────────────────────────────┘
```

## 2. Vínculo propiedad ↔ instancia (R1, R2)

`PropiedadesService.crear` (módulo de #6) se **extiende**: tras el INSERT de
la ficha, y en la misma transacción de la petición, resuelve la definición
y crea la instancia con `entidad_tipo = 'propiedad'` y `entidad_id = id` de
la ficha. Si la instancia falla, la excepción hace rollback de todo (el
`TenantContextInterceptor`).

Resolución de la definición (R2): **copia TENANT del tenant si existe,
si no la SISTEMA**. Se añade al `WorkflowRepository` del motor un método
`buscarDefinicionParaTenant(ctx, tipo)` con esa precedencia (la copia es
`tenant_id = ctx`; la plantilla `tenant_id = reservado`, ambas visibles por
RLS). Es la única modificación al módulo del motor.

Las propiedades preexistentes sin instancia (solo en dev: no hay
producción) se muestran con `estado_ciclo_vida: null`; el backfill real
será parte de #9 o de una migración de datos cuando existan datos.

## 3. Superficie HTTP (3 rutas + la ficha extendida)

| Método y ruta | Servicio | R | Auditoría |
|---|---|---|---|
| `GET /propiedades/dashboard` | `DashboardService.consultar` | R9, R10, R11, R12 | — |
| `GET /propiedades/:id/ciclo-vida` | `CicloVidaService.consultar` | R4 | — |
| `POST /propiedades/:id/ciclo-vida/transiciones/:claveTransicion` | `CicloVidaService.ejecutar` | R5, R6, R7 | `@Audit('actualizar','propiedad')` |
| `GET /propiedades/:id` (**extendido**) | `PropiedadesService.obtener` | R3 | — |

**`GET /propiedades/dashboard` se registra ANTES de `GET /propiedades/:id`**
en el array de controllers del módulo: Express empareja en orden de
registro, y `dashboard` no es un uuid, así que el segmento nunca colisiona
con un id real. `RUTAS_PERMITIDAS` +3 (R16).

Firmas nuevas relevantes:

```ts
// ciclo-vida.service.ts (módulo propiedades)
consultar(propiedadId, actorId, ctx): Promise<CicloVidaDePropiedad>;
// { estado: {clave, etiqueta, desde}, transiciones_disponibles: [{clave, id}] }

ejecutar(propiedadId, claveTransicion, contexto, actorId, ctx): Promise<WorkflowInstancia>;
// resuelve instancia + transicion por clave, delega en WorkflowService.ejecutarTransicion

// dashboard.service.ts (módulo propiedades)
consultar(filtros: { estado?: string; tipo?: TipoPropiedad }, ctx): Promise<DashboardPropiedades>;
// { conteos: [{clave, etiqueta, cantidad}], propiedades: [DashboardFila] }

// DashboardFila: ficha basica + estado_ciclo_vida {clave, etiqueta} +
// tiempo_en_estado_segundos + instancia_id
```

## 4. Dashboard (R9, R10, R11, R12)

Una consulta sobre el motor (sin tocar `propiedad.estado`, que no existe):

```sql
SELECT e.clave, e.etiqueta, count(*)::int AS cantidad
  FROM propiedad p
  JOIN workflow_instancia i
    ON i.entidad_tipo = 'propiedad' AND i.entidad_id = p.id
  JOIN workflow_estado e ON e.id = i.estado_actual_id
 WHERE p.tenant_id = $1 AND p.activo = true
   [AND e.clave = $estado]
 GROUP BY e.clave, e.etiqueta ORDER BY e.clave;
```

- Conteos: siempre de las propiedades ACTIVAS del tenant (sin filtro de
  estado → todos los estados con conteo; con `estado` → solo ese).
- Listado: propiedades activas con `estado_ciclo_vida`
  (`clave`/`etiqueta` del join), `instancia_id` (R12),
  `tiempo_en_estado_segundos = extract(epoch from (now() - i.updated_at))`
  (R11) y los filtros `tipo`/`estado` (R10).
- Orden del listado: `tiempo_en_estado_segundos DESC` (las estancadas
  primero — el propósito de RF-PI5).

## 5. Ejecución de transiciones (R5, R6, R7)

`CicloVidaService.ejecutar`:
1. Exige la propiedad (404 si ajena/inexistente — R13).
2. Resuelve la instancia por `(entidad_tipo='propiedad', entidad_id)`
   (404 si no hay: caso dev/pre-backfill).
3. Lee las transiciones de la definición y encuentra la de `clave` — si no
   existe o no es `HUMANA` → 409 `TRANSICION_NO_DISPONIBLE` (R5, sin
   distinguir).
4. Delega en `WorkflowService.ejecutarTransicion(instanciaId, transicionId,
   contexto, actorId, ctx)` — el motor valida origen/activa/condición/rol
   (403/409, R6), ejecuta la cascada automática y escribe su log
   append-only (R7).
5. El `@Audit` del controller registra la entrada de `audit_log` (R7).

## 6. Ficha extendida (R3)

`PropiedadesService.obtener` resuelve `estado_ciclo_vida` consultando la
instancia y el estado (`clave`, `etiqueta`, `desde` = `updated_at` de la
instancia). `null` si la propiedad aún no tiene instancia. El tipo
`PropiedadConExtras` se amplía con el campo (packages/types).

## 7. Auditoría y PII (R7, R15)

- El log de dominio lo escribe el motor (append-only, contexto en
  `contexto_tras` — dato de dominio).
- `audit_log` recibe la entrada de acción crítica vía `@Audit`, `metadata`
  vacío (nada de direcciones/contextos — R15).
- Los logs de aplicación no vuelcan el contexto (patrón #7 R16).

## 8. Archivos

### Se crean

```
apps/api/src/modules/core/propiedades/ciclo-vida.service.ts
apps/api/src/modules/core/propiedades/ciclo-vida.controller.ts
apps/api/src/modules/core/propiedades/dashboard.service.ts
apps/api/src/modules/core/propiedades/dashboard.controller.ts
apps/api/src/modules/core/propiedades/dto/ciclo-vida.dto.ts   (contexto opcional)
apps/api/src/modules/core/propiedades/__tests__/{ciclo-vida.api.test.ts,dashboard.api.test.ts}
apps/api/src/modules/core/propiedades/__tests__/ciclo-vida-seguridad.api.test.ts
apps/api/src/modules/core/workflows/__tests__/resolucion-definicion.test.ts
packages/types/src/ciclo-vida.ts
```

### Se modifican

```
apps/api/src/modules/core/propiedades/propiedades.service.ts    (instancia al crear + ficha con estado)
apps/api/src/modules/core/propiedades/propiedades.repository.ts (join del estado en obtener)
apps/api/src/modules/core/propiedades/propiedades.module.ts     (importa WorkflowsModule, +controllers/services)
apps/api/src/modules/core/workflows/workflow.repository.ts      (buscarDefinicionParaTenant)
packages/types/src/index.ts
apps/api/src/modules/core/__tests__/routes-surface.test.ts      (RUTAS_PERMITIDAS +3)
feature_list.json                                               (#8 → spec_ready)
```

## 9. Alternativas descartadas

1. **Columna `propiedad.estado` denormalizada.** Descartada (PA-8-1): dos
   sitios que «saben» el estado divergen en silencio; el motor ya lo tiene y
   lo audita. La ficha y el dashboard leen por join.
2. **Usar directamente el endpoint genérico del motor desde el cliente.**
   Descartada (PA-8-4): el módulo de negocio debe validar la propiedad
   (404) y exponer transiciones por `clave` estable (el motor usa ids
   internos); el motor sigue genérico (RF-A4).
3. **Crear la instancia perezosamente al primer GET.** Descartada
   (PA-8-2): una propiedad sin máquina es un estado inconsistente; crearla
   en la misma transacción del alta es atómico y testeable.
4. **Tiempo en estado por la fecha del log.** Descartada: `updated_at` de
   la instancia ya es «última transición» y evita una subconsulta al log.

## 10. Estado de las ambigüedades

Las cuatro decisiones de la puerta (PA-8-1…PA-8-4) quedan explícitas. Sin
migración ni dependencias nuevas. No quedan ambigüedades de producto.
