# Design — property_intake

> Feature #9. Ingreso de propiedad (vacante y migración).
> Este documento asume `docs/architecture.md` y `docs/conventions.md`; solo
> documenta los puntos donde la feature roza sus fronteras.

---

## 1. Origen: un endpoint que orquesta lo ya construido

El PRD §12.1 describe el ingreso como un **flujo**: resolver/crear
propietario → registrar la ficha → (escenario B) resolver/crear inquilino →
asociar → estado final. Cada pieza ya existe (perfiles #5, ficha #6,
instancia #8); #9 aporta la **orquestación atómica** en un solo endpoint,
sin duplicar lógica.

```
POST /propiedades/ingreso
 1. resolver/crear PROPIETARIO (R3)          → PropietariosService / IdentidadService
 2. crear PROPIEDAD + instancia              → PropiedadesService.crear (R1 de #8)
 3. si ARRENDADA:
    a. resolver/crear INQUILINO (R4)         → InquilinosService
    b. asignar inquilino actual + historial  → OcupacionService.asignarInquilinoActual
    c. cadena a `arrendada` por claves       → WorkflowService (vía claves de #8)
 4. responder 201 con la ficha
```

Todo corre en la transacción de la petición (`TenantContextInterceptor`):
un fallo en cualquier paso revierte TODO (R6, PA-9-4).

## 2. Reutilización de perfiles (R3, R4, PA-9-3)

- **Por id** (`perfil_propietario_id`): se valida con `obtener` de #5 →
  404 si inexistente/ajeno (R10).
- **Por datos en línea** (`propietario: { nombre, tipo_documento,
  documento, ... }`):
  1. `buscarPorDocumento` (perfil) en el tenant;
  2. si existe: se compara `nombre` con `nombresCoinciden` (#26, PA-5:
     sin plegar tildes); si diverge → 409 `NOMBRE_NO_COINCIDE_CON_IDENTIDAD`
     sin escribir nada (PA-9-3);
  3. si no existe: se crea con `PropietariosService.crear` /
     `InquilinosService.crear` (que internamente usa
     `resolverIdentidad`, la deduplicación de #26, y puede lanzar el mismo
     409 si la identidad ya existe con otro nombre).

## 3. La cadena del escenario B (R2, R7, R9)

Se ejecuta por **claves** (el camino de negocio de #8), no por ids: las
transiciones de la máquina se resuelven igual que en la ficha. La cadena es
`iniciar_checkeo` → `enviar_aseguradora` → `arrendar`, cada una con el
actor del ingreso y su log en `workflow_transicion_log` (R9).

**Si la copia del tenant desactivó alguna transición de la cadena**, el
ingreso falla con 409 y revierte todo (R6): el empleado completa el ciclo
manualmente por la ficha. Es el comportamiento correcto: la personalización
de RF-W2 puede bloquear la automatización, y el ingreso no la ignora.

## 4. Auditoría del servicio (R8)

Las mutaciones del ingreso ocurren **dentro del servicio** (no pasan por
controllers), así que el `AuditInterceptor` no las ve. El `IngresoService`
registra explícitamente con `AuditService.log` cada acción crítica:

| Acción | `entity_type` | `entity_id` |
|---|---|---|
| propietario creado (si fue creación) | `perfil_propietario` | id del perfil |
| inquilino creado (si fue creación) | `perfil_inquilino` | id del perfil |
| propiedad creada | `propiedad` | id de la ficha |
| cada transición de la cadena | `propiedad` | id de la propiedad |

`metadata` siempre vacío (R12). El `@Audit` del controller NO se usa para
las sub-acciones: solo la entrada del ingreso como tal si se quisiera.

## 5. Superficie HTTP (1 ruta)

| Método y ruta | Rol | R | Auditoría |
|---|---|---|---|
| `POST /propiedades/ingreso` | admin/empleado | R1..R7, R10 | (explícita en el servicio, R8) |

`POST /propiedades/ingreso` no colisiona con `POST /propiedades` ni con las
rutas con `:id`: es un POST con un segmento más, y no existe ningún
`POST /propiedades/:id` desnudo.

DTO del ingreso (zod):

```ts
esquemaIngresoPropiedad = z.discriminatedUnion('escenario', [
  z.object({ escenario: z.literal('VACANTE'),
             propietario: UnionIdODatos,
             propiedad: esquemaCrearPropiedad.omit({ propietario_principal_id: true }) })
    .strict(),
  z.object({ escenario: z.literal('ARRENDADA'),
             propietario: UnionIdODatos,
             propiedad: ...,
             inquilino: UnionIdODatos })
    .strict(),
])
// UnionIdODatos: { perfil_id: uuid } | { datos: esquemaCrearPropietarioInLine }
```

Firmas nuevas relevantes:

```ts
// ingreso.service.ts
ingresar(dto: IngresoPropiedadDto, ctx: ContextoPeticion): Promise<PropiedadConExtras>;
// resuelve propietario/inquilino, crea la ficha, asigna y transiciona; atómico.

// resolver-perfil.ts (helper del módulo)
resolverPropietario(dto: IdODatosPropietario, ctx): Promise<string>;   // id del perfil
resolverInquilino(dto: IdODatosInquilino, ctx): Promise<string>;
```

## 6. Archivos

### Se crean

```
apps/api/src/modules/core/propiedades/ingreso.service.ts
apps/api/src/modules/core/propiedades/ingreso.controller.ts
apps/api/src/modules/core/propiedades/dto/ingreso.dto.ts
apps/api/src/modules/core/propiedades/__tests__/ingreso.api.test.ts
apps/api/src/modules/core/propiedades/__tests__/ingreso-seguridad.api.test.ts
apps/api/src/modules/core/propiedades/__tests__/ingreso.service.test.ts
```

### Se modifican

```
apps/api/src/modules/core/propiedades/propiedades.module.ts   (+controller/service)
apps/api/src/modules/core/__tests__/routes-surface.test.ts     (RUTAS_PERMITIDAS +1)
packages/types/src/propiedades.ts                              (tipos del ingreso si hace falta)
feature_list.json                                              (#9 → spec_ready)
```

## 7. Alternativas descartadas

1. **Tres llamadas del cliente (propietario → propiedad → inquilino →
   transiciones).** Descartada: pierde la atomicidad (R6) y convierte el
   ingreso en un protocolo de varias peticiones donde un fallo a medias
   deja la ficha sin máquina coherente.
2. **Un endpoint genérico de "crear en línea" para perfiles.** Descartada:
   D-4 de #5 ya fijó la semántica de dos pasos para los endpoints
   individuales; el ingreso es el único flujo que crea en línea, y lo hace
   dentro de su orquestación atómica.
3. **Repetir la lógica de crear-perfil dentro de ingreso.** Descartada:
   se reutilizan los servicios de #5/#6/#8 tal cual (R3/R4).
4. **Ejecutar la cadena del escenario B por ids de transición.** Descartada
   (PA-9-4, §3): por claves, el mismo camino de la ficha, y la
   personalización del tenant se respeta.

## 8. Estado de las ambigüedades

Las cuatro decisiones de la puerta (PA-9-1…PA-9-4) quedan explícitas. Sin
migración ni dependencias nuevas. No quedan ambigüedades de producto.
