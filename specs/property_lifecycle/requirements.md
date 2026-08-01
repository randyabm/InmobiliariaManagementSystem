# Requirements — property_lifecycle

> Feature #8. Ciclo de vida de la propiedad y dashboard.
> Anclaje al PRD: **RF-P4** (estado gobernado por el motor de workflows,
> §12.2), **RF-P5** (dashboard de propiedades, §12.3), **RF-PI4** (cada
> transición auditada y capaz de disparar notificaciones), **RF-PI5**
> (conteos, filtros y tiempo en estado), **RF-PI6** (desde el dashboard se
> abre la hoja de vida y se ejecuta la acción del estado), **RF-W3**
> (frontera), **RF-W1/W2** (motor), **RF-C3** y **D2** (RBAC + RLS).

Notación EARS estricta (`docs/specs.md`). Un solo `DEBE` por requirement.

## Dependencias

- **#7 `workflow_engine` (done):** el motor dirigido por datos con la
  definición sembrada `ciclo_vida_propiedad` (RF-P4, estados
  disponible/en_checkeo/con_aseguradora/arrendada/en_desocupacion/inactiva).
  `WorkflowService` se exporta y se reutiliza sin duplicar nada.
- **#6 `property_profile` (done):** la ficha (`propiedad`) y su frontera
  PA-6-3: «la ficha queda lista para que #8 añada el estado». Este spec la
  cierra leyendo el estado del motor, sin columna nueva.

## Fronteras explícitas (qué NO es de #8)

- **Enviar notificaciones (RF-W3/RF-PI4):** la transición puede declarar el
  hook `notificacion` como dato (ya lo hace el motor); **enviarlas** es la
  feature **#10** `notifications`. #8 no toca ningún proveedor.
- **Ingreso de propiedad y creación en línea (RF-PI1..PI3):** es la feature
  **#9** `property_intake`. #8 crea la instancia al crear la propiedad por
  la ficha (R1); #9 reutilizará el mismo camino en su flujo de ingreso.
- **Afianzamiento/captura de póliza (RF-PI7/PI8):** es la feature **#20**.
  El estado `con_aseguradora` transiciona aquí; la póliza se captura allá.

---

## Grupo A — El vínculo propiedad ↔ máquina (RF-P4)

### R1 — (RF-P4, RF-W1) La propiedad nace con su instancia

CUANDO una propiedad se crea por la ficha (`POST /propiedades`), el sistema
DEBE crear, en la misma transacción, la instancia del workflow
`ciclo_vida_propiedad` para esa entidad, quedando en el estado `disponible`.
SI la creación de la instancia falla ENTONCES la creación de la propiedad
DEBE abortar completa (rollback de ambas).

### R2 — (RF-W2, RF-A4) La definición usada: la copia del tenant o la del sistema

CUANDO se resuelve la definición para una propiedad del tenant, el sistema
DEBE usar la copia `TENANT` de `ciclo_vida_propiedad` si existe; si no, la
plantilla `SISTEMA`. Las instancias ya creadas NO cambian de definición si
el tenant clona después (la máquina en curso sigue su definición de origen).

### R3 — (RF-P1 grupo estado, RF-P4) La ficha expone el estado sin duplicarlo

CUANDO un usuario autorizado invoca `GET /propiedades/:id`, el sistema DEBE
incluir en la respuesta `estado_ciclo_vida` (`{ clave, etiqueta, desde }`)
leído de la instancia del motor y NO DEBE almacenar ninguna columna de
estado en `propiedad` (el estado vive en un solo sitio: la instancia).

---

## Grupo B — Transiciones desde la ficha (RF-P4, RF-PI4, RF-PI6)

### R4 — (RF-PI6) Consultar el ciclo de vida de la propiedad

CUANDO un usuario autorizado invoca `GET /propiedades/:id/ciclo-vida`, el
sistema DEBE responder 200 con el estado actual (`clave`, `etiqueta`,
`desde`) y las transiciones **humanas** disponibles para ese actor (las que
el motor valida: origen, activa, condición y rol). 404 si la propiedad no
existe o es de otro tenant.

### R5 — (RF-P4, RF-PI6) Ejecutar la acción del estado

CUANDO un usuario autorizado invoca
`POST /propiedades/:id/ciclo-vida/transiciones/:claveTransicion` con un
`contexto` opcional, el sistema DEBE resolver la instancia de la propiedad,
resolver la transición por su `clave` dentro de la definición, y delegar la
ejecución en el motor (que valida estado origen, activa, condición con el
contexto fusionado y rol — 403 rol / 409 `TRANSICION_NO_DISPONIBLE`).
SI la transición no existe ENTONCES el sistema DEBE responder 409 sin
distinguir el motivo.

### R6 — (RF-P4) Las transiciones inválidas se rechazan sin efecto

SI una petición pide una transición cuyo estado origen no es el actual, o
cuya condición no se cumple, o que está inactiva ENTONCES el sistema DEBE
responder 409 `TRANSICION_NO_DISPONIBLE` y NO DEBE cambiar el estado ni
escribir ninguna fila de log.

### R7 — (RF-PI4) Cada transición queda auditada

CUANDO una transición del ciclo de vida se ejecuta, el sistema DEBE
registrar la fila en `workflow_transicion_log` (motor, append-only) Y una
entrada en `audit_log` con `tenant_id`, `actor_id`, `accion`,
`entity_type = 'propiedad'` y `entity_id` = id de la propiedad, sin datos
personales en `metadata`.

### R8 — (RF-PI4, RF-W3 frontera) El hook de notificación es dato

CUANDO una transición del ciclo de vida declara `notificacion` como dato,
el sistema NO DEBE enviar ninguna notificación (la ejecución es la feature
#10); el hook queda disponible para que #10 lo consuma.

---

## Grupo C — Dashboard de gestión (RF-P5, RF-PI5, RF-PI6)

### R9 — (RF-PI5) Conteos por estado

CUANDO un usuario autorizado invoca `GET /propiedades/dashboard`, el
sistema DEBE responder 200 con los conteos de propiedades activas agrupadas
por estado del ciclo de vida (`clave`, `etiqueta`, `cantidad`), leyendo el
estado de las instancias del motor, y la lista de propiedades con su estado.

### R10 — (RF-PI5) Filtros

CUANDO `GET /propiedades/dashboard` recibe los filtros `estado` (clave) o
`tipo` (de propiedad), el sistema DEBE limitar el listado —y, si `estado`
está presente, los conteos— a las propiedades que los cumplen.

### R11 — (RF-PI5) Tiempo en el estado actual

CUANDO el dashboard devuelve cada propiedad, el sistema DEBE incluir
`tiempo_en_estado_segundos` calculado como el tiempo transcurrido desde la
última transición de su instancia (el `updated_at` de la instancia), para
detectar propiedades estancadas.

### R12 — (RF-PI6) Del dashboard a la acción

CUANDO el dashboard devuelve una propiedad, el sistema DEBE incluir su
`estado_ciclo_vida` y el `id` de la instancia, de modo que el cliente pueda
abrir la hoja de vida y ejecutar la acción correspondiente por las rutas de
R4/R5.

---

## Grupo D — Invariantes de seguridad (obligatorios, `docs/specs.md`)

### R13 — (RF-A1, RF-C3) Aislamiento y autorización

SI una petición autenticada en el tenant A consulta o ejecuta el ciclo de
vida, o el dashboard, de propiedades del tenant B ENTONCES el sistema DEBE
responder 404 sin revelar su existencia (las propiedades de B no aparecen
en el dashboard de A). SI un usuario sin el rol requerido invoca los
endpoints de esta feature ENTONCES el sistema DEBE rechazar con 403 en el
backend (401 sin token).

### R14 — (RF-C3, `docs/architecture.md`) Sin contexto de tenant, falla

SI un repositorio de esta feature se ejecuta sin contexto de tenant
establecido ENTONCES el sistema DEBE fallar con `SinContextoDeTenantError`.

### R15 — (§11.3, Ley 1581 de 2012) Datos personales fuera de logs

EL sistema NO DEBE incluir direcciones, matrículas, documentos ni contactos
en el `metadata` de `audit_log` ni en los logs de aplicación; el `contexto`
de las transiciones no se vuelca a los logs (el patrón de #7 R16).

---

## Grupo E — Gobernanza del cambio

### R16 — (C4/C6, `docs/conventions.md`) Sin esquema nuevo y listas al día

EL sistema NO DEBE añadir ninguna tabla ni columna nueva (el estado vive en
las tablas del motor, #7): `TABLAS_PERMITIDAS` no cambia. `RUTAS_PERMITIDAS`
DEBE actualizarse con las 3 rutas nuevas (`GET /propiedades/dashboard`,
`GET /propiedades/:id/ciclo-vida`,
`POST /propiedades/:id/ciclo-vida/transiciones/:claveTransicion`) en el
mismo cambio. Si en el futuro hiciera falta una migración, DEBE ser única,
versionada, forward-only e idempotente.

---

## CRITERIOS DE ACEPTACIÓN del humano (feature_list.json #8)

| Criterio | R que lo satisface |
|---|---|
| La propiedad transiciona entre Disponible, En checkeo, Con aseguradora, Arrendada, En desocupación e Inactiva sobre el motor | R1, R2, R4, R5, R6 |
| Dashboard con conteo por estado, filtros y tiempo en el estado actual | R9, R10, R11 |
| Desde el dashboard se ejecuta la acción que corresponde a cada estado | R4, R5, R12 |
| Transiciones inválidas se rechazan | R6 |

## DECISIONES que el humano confirma en la puerta del spec

| Id | Pregunta | Decisión propuesta | Motivo |
|---|---|---|---|
| **PA-8-1** | ¿El estado se duplica en `propiedad`? | **No**: se lee de la instancia del motor (ficha por join, dashboard por join). Cero esquema nuevo (R3, R16) | El estado vive en un solo sitio; una columna desincronizada es el clásico defecto que esta sesión persigue |
| **PA-8-2** | ¿Cuándo se crea la instancia? | Al crear la propiedad, en la misma transacción (R1); las propiedades preexistentes sin instancia se muestran sin estado hasta que #9/migración de datos las respalde (no hay producción) | Atómico y sin propiedades huérfanas |
| **PA-8-3** | ¿Qué definición usa la instancia? | La copia `TENANT` si existe; si no, la `SISTEMA` (R2) | Respeta la personalización de RF-W2; los clones futuros no cambian máquinas en curso |
| **PA-8-4** | ¿Dónde se ejecutan las acciones? | Rutas de negocio de #8 que envuelven al motor (`/propiedades/:id/ciclo-vida/...`); el endpoint genérico queda para otros módulos (R4, R5) | El módulo de negocio valida la propiedad; el motor sigue genérico (RF-A4) |

**No quedan preguntas de producto abiertas** (las cuatro decisiones quedan
explícitas para la puerta del spec).
