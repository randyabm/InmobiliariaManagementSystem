# Implementación — feature #7 (`workflow_engine`)

**Status:** implementación completa, a la espera del review. Suite: `npm run
test` **619** (61 archivos) + `npm run test:db` **108** (3 archivos). Lint,
typecheck y build verdes.

## Mapa de trazabilidad R1–R17 → test concreto

| R | Enunciado (resumen) | Test que lo cubre |
|---|---|---|
| R1 | Tabla `workflow_definicion` con UNIQUE (tenant, tipo) | `migrations.db.test.ts` + `workflows-rls.test.ts` |
| R2 | Tablas `workflow_estado` y `workflow_transicion` (filas) | `migrations.db.test.ts` (seed) + `workflows.api.test.ts` T15 |
| R3 | Condiciones JSONB whitelisted, fail closed | `evaluador-condiciones.test.ts` T7 + `workflows.api.test.ts` T16 (rama condicional) |
| R4 | Clonar plantilla (404 ajena, 409 tipo duplicado) | `workflows.api.test.ts` T19 |
| R5 | Editar solo la copia TENANT (409 en SISTEMA) | `workflows.api.test.ts` T19 (hack → 409) |
| R6 | Crear instancia en estado inicial; 409 duplicada | `workflows.api.test.ts` T15 + `workflow.service.test.ts` T11 |
| R7 | Ejecutar humana: 403 rol / 409 resto, sin distinguir | `workflow.service.test.ts` T11 + `workflows.api.test.ts` T18 |
| R8 | Cascada automática con límite 10 y rollback | `workflow.service.test.ts` T11 (ciclo) + `workflows.api.test.ts` T17 |
| R9 | Estado + transiciones disponibles para el actor | `workflow.service.test.ts` T11 + `workflows.api.test.ts` (disponibles implícito en T15) |
| R10 | Log append-only con contexto_tras | `migrations.db.test.ts` (triggers, dueño) + `workflows.api.test.ts` T15/T17 |
| R11 | Historial ordenado ascendente | `workflows.api.test.ts` T15 |
| R12 | UNIQUE instancia por (definición, entidad) | `workflows.api.test.ts` (409 duplicada) + `migrations.db.test.ts` |
| R13 | RLS: sistema legible, no escribible (PA-7-1) | `workflows-rls.test.ts` T5/T20 + `migrations.db.test.ts` (política) |
| R14 | 404 cross-tenant y 403/401 | `workflows-seguridad.api.test.ts` T21/T22 |
| R15 | Sin contexto falla; auditoría de mutaciones | `workflows-rls.test.ts` (virgen) + `workflows-seguridad.api.test.ts` T23 |
| R16 | Contexto fuera de audit_log y logs | `workflows-seguridad.api.test.ts` T24 |
| R17 | Migración única + seed `ciclo_vida_propiedad` + TABLAS/RUTAS | `migrations.db.test.ts` (seed) + `workflows.api.test.ts` T15 (aceptación) |

**Anclaje al PRD:** R1–R17 citan RF-W1..W5, RF-A4, RF-P4/§12.2, D3, D2.
Ningún requirement sin origen.

## Decisiones PA-7 ejecutadas (aprobadas en la puerta del spec)

- **PA-7-1 — Plantillas del sistema con tenant reservado:** la política de
  `workflow_definicion` lee `OR sistema AND contexto presente` (endurecida
  durante la implementación: sin esa condición, una conexión sin contexto
  veía las plantillas del sistema) con `WITH CHECK` propio; la de
  estado/transición tiene `WITH CHECK` para impedir escrituras contra
  definiciones del sistema (lección de `0003`).
- **PA-7-2 — Evaluador whitelisted:** `evaluador-condiciones.ts` puro, fail
  closed (operador desconocido → falso); el DTO además rechaza operadores
  fuera de la lista al crear.
- **PA-7-3 — Cascada en la misma transacción:** máx. 10 → `CICLO_AUTOMATICO`
  y rollback de la petición entera (probado con una definición cíclica).
- **PA-7-4 — RF-W2 base:** clonar + añadir/baja transiciones solo `admin`;
  límites por paquete/RF-A5 anotados para la feature de paquetes.

## Defecto real encontrado y corregido durante la implementación

`copiarDefinicion` unía las transiciones del clon contra `$2` (la definición
ORIGEN) en vez de `$1` (la copia): las transiciones clonadas apuntaban a los
estados del sistema. El test de cascada sobre la copia (T17) lo detectó
(409 en una transición que debía estar disponible); el debug mostró los ids
de origen apuntando fuera de la copia. Corregido y cubierto por el test.

## Desviaciones anotadas (todas en el spec o menores)

1. **La política del sistema exige contexto presente** (endurecimiento de
   PA-7-1): sin `current_setting(...) IS NOT NULL`, la conexión virgen
   filtraba las plantillas del sistema — el invariante R15 «sin contexto no
   se ve nada» habría quedado a medias.
2. **`workflow_estado`/`workflow_transicion` no llevan `tenant_id`**: su RLS
   es por subconsulta a `workflow_definicion` (visibilidad propia o del
   sistema), con `WITH CHECK` propio. Documentado en la migración.
3. **`@Audit` de la ejecución registra `entity_id` = id de la instancia**
   (el fallback `idTransicion` del interceptor cubre la baja de transiciones
   de la gestión de definiciones).

## Candidatas a mutación (para el reviewer)

1. Quitar el chequeo de rol (R7) → rompe T11 (403) y el 403 de la gestión.
2. `cumpleCondicion` con operador desconocido → verdadero (fail open) →
   rompe T7 y la rama condicional de T16.
3. Cascada sin límite (o sin rollback) → rompe T11 (ciclo) y T18.
4. `copiarDefinicion` volviendo a `$2` en el join → rompe T17 (el defecto
   real reaparece).
5. Quitar el `WITH CHECK` de la política de `workflow_definicion` (o el
   `IS NOT NULL` del OR) → rompe `workflows-rls.test.ts` (T5/virgen).
6. `ejecutarTransicion` evaluando la condición con el contexto VIEJO (sin
   fusionar el extra) → rompe T11 («contexto extra se fusiona antes»).
7. Quitar el registro del log en la cascada → rompe T17 (2 filas).
