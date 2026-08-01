# Implementación — feature #8 (`property_lifecycle`)

**Status:** implementación completa, a la espera del review. Suite: `npm run
test` **652** (67 archivos) + `npm run test:db` **108** (3 archivos). Lint,
typecheck y build verdes. **Sin migración** (PA-8-1: el estado vive en las
tablas del motor #7).

## Mapa de trazabilidad R1–R16 → test concreto

| R | Enunciado (resumen) | Test que lo cubre |
|---|---|---|
| R1 | La propiedad nace con su instancia (misma transacción) | `ciclo-vida-vinculo.api.test.ts` T5 (SELECT de la instancia en `disponible`) |
| R2 | Definición: copia TENANT o SISTEMA | `resolucion-definicion.test.ts` T2 (unit SQL) + `ciclo-vida-vinculo.api.test.ts` T6 (integración) |
| R3 | Ficha con estado_ciclo_vida, sin columna duplicada | `ciclo-vida-vinculo.api.test.ts` T5 (ficha + `information_schema` sin columna estado) |
| R4 | GET ciclo-vida: estado + disponibles para el actor | `ciclo-vida.api.test.ts` T11 |
| R5 | Ejecutar por clave; 409 si no existe; contexto opcional | `ciclo-vida.api.test.ts` T11/T12 + `ciclo-vida.service.test.ts` T21 |
| R6 | Transiciones inválidas → 409 sin efecto | `ciclo-vida.api.test.ts` T11 (SELECT: estado y log intactos) |
| R7 | Log del motor + audit_log con entity_id = propiedad | `ciclo-vida.api.test.ts` T13 + T11 (log del motor) |
| R8 | Hook de notificación es dato; nada se envía | `ciclo-vida-seguridad.api.test.ts` T20 (sin tablas de notificación) |
| R9 | Conteos por estado + listado | `dashboard.api.test.ts` T14 (comparados con SELECTs) |
| R10 | Filtros estado/tipo | `dashboard.api.test.ts` T15 |
| R11 | Tiempo en estado (seconds) | `dashboard.api.test.ts` T14/T16 (≥ 0 y orden DESC) |
| R12 | Del dashboard a la acción (estado + instancia_id) | `dashboard.api.test.ts` T14 |
| R13 | 404 cross-tenant, 403/401 | `ciclo-vida-seguridad.api.test.ts` T17/T18 |
| R14 | Sin contexto falla | heredado del motor (R15 de #7, `workflows-rls.test.ts`) |
| R15 | Contexto/PII fuera de audit_log y logs | `ciclo-vida-seguridad.api.test.ts` T19 |
| R16 | Sin esquema nuevo; RUTAS_PERMITIDAS +3 | `routes-surface.test.ts` (3 rutas) + `ciclo-vida-vinculo` (sin columna estado) |

**Anclaje al PRD:** R1–R16 citan RF-P4, RF-P5, RF-PI4..PI6, RF-W1/W2/W3,
RF-C3, D2. Ningún requirement sin origen.

## Decisiones PA-8 ejecutadas (aprobadas en la puerta del spec)

- **PA-8-1 — Estado solo en el motor:** `propiedad` no tiene columna de
  estado (verificado contra `information_schema`); ficha y dashboard leen
  por join de la instancia. Cero esquema nuevo.
- **PA-8-2 — Instancia al crear la propiedad:** `PropiedadesService.crear`
  extiende la transacción de la petición con la creación de la instancia;
  si falla, todo revierte (el `TenantContextInterceptor`).
- **PA-8-3 — Copia TENANT o SISTEMA:** `buscarDefinicionParaTenant` con
  precedencia por `CASE WHEN`; probado en ambas direcciones (T6).
- **PA-8-4 — Rutas de negocio que envuelven al motor:** la envoltura solo
  valida la propiedad (404) y resuelve la clave; toda la lógica de la
  máquina sigue en `WorkflowService` (sin duplicación).

## Desviaciones anotadas (todas en el spec o menores)

1. **`@Audit` de la ejecución usa `extractEntityId`**: el response del motor
   es la instancia (id de la máquina), así que el decorador extrae
   `propiedad_id` del envoltorio `{ propiedad_id, instancia }` para que
   `entity_id` = id de la PROPIEDAD (R7), no el de la instancia.
2. **`DashboardController` registrado ANTES de `PropiedadesController`** en
   el array del módulo: Express empareja en orden y `dashboard` nunca es un
   uuid. Documentado en el módulo y en `RUTAS_PERMITIDAS`.
3. **`WorkflowService` ganó tres métodos de lectura** (`resolverDefinicionParaTenant`,
   `transicionesDeDefinicion`, `buscarInstanciaDeEntidad`): extensiones de
   solo-lectura sobre el repositorio del motor, sin tocar su lógica.

## Candidatas a mutación (para el reviewer)

1. Quitar la creación de la instancia en `PropiedadesService.crear` → rompe
   T5 (instancia no existe) y T6.
2. `buscarDefinicionParaTenant` sin la precedencia (solo SISTEMA, o solo
   TENANT) → rompe T6 (una de las dos direcciones).
3. `estadoCicloVida` leyendo una columna de `propiedad` (o sin el join) →
   rompe T5 (ficha con estado) o el check de `information_schema`.
4. `CicloVidaService.ejecutar` delegando sin resolver la clave (o aceptando
   claves AUTOMATICA) → rompe T21 (409) y T11.
5. `extractEntityId` sin `propiedad_id` (entity_id = instancia) → rompe T13
   (audit con entity_id de la propiedad).
6. Dashboard sin filtro de tenant explícito → rompe T17 (propiedades de B
   aparecen) — el RLS ya lo cubre, pero el predicado explícito es la doble
   barrera.
