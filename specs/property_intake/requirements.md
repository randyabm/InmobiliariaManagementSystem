# Requirements — property_intake

> Feature #9. Ingreso de propiedad (vacante y migración).
> Anclaje al PRD: **RF-PI1** (ambos escenarios, §12.1), **RF-PI2** (crear
> propietario/inquilino en línea, RF-C6), **RF-PI3** (template de contrato —
> frontera con #16), **RF-P4** (estado correcto al terminar el ingreso),
> **RF-C5/RF-C4** (perfiles), **RF-C3** y **D2** (RBAC + RLS), §11.3
> (auditoría e invariantes).

Notación EARS estricta (`docs/specs.md`). Un solo `DEBE` por requirement.

## Dependencias

- **#6 `property_profile` (done):** `PropiedadesService.crear` (la ficha +
  la instancia del ciclo de vida, R1 de #8), `PropietariosService`,
  `InquilinosService`, `OcupacionService` (inquilino actual + historial).
- **#8 `property_lifecycle` (done):** el camino por claves
  (`/propiedades/:id/ciclo-vida/transiciones/:clave`) y las transiciones de
  la máquina sembrada.
- **#26 (done):** `IdentidadService.resolverIdentidad` y `nombresCoinciden`
  (el criterio de comparación de nombres, PA-5: sin plegar tildes).

## Fronteras explícitas (qué NO es de #9)

- **RF-PI3 — template de contrato validado al terminar el ingreso:** es la
  feature **#16 `contract_templates`** (fase 1c). La aceptación de #9 no la
  incluye: el ingreso termina con la propiedad en el estado correcto, y
  cuando #16 exista, la extenderá (PA-9-1).
- **Digitalización del contrato físico del escenario B (§13.4):** es la
  feature **#18 `contract_digitization`** (PA-9-2). El ingreso asocia al
  inquilino y deja la propiedad en `arrendada`; el contrato se anexa allá.
- **Póliza/afianzamiento (RF-PI7/PI8):** es la feature **#20**.

---

## Grupo A — El ingreso (RF-PI1, RF-PI2, RF-P4)

### R1 — (RF-PI1) Escenario A: propiedad vacante

CUANDO un usuario con rol `admin` o `empleado` envía
`POST /propiedades/ingreso` con `escenario = 'VACANTE'` y los datos del
propietario y de la propiedad, el sistema DEBE crear (o reutilizar) el
propietario, crear la propiedad con su instancia del ciclo de vida y
responder 201 con la ficha en el estado `disponible`.

### R2 — (RF-PI1) Escenario B: propiedad ya arrendada en migración

CUANDO un usuario con rol `admin` o `empleado` envía
`POST /propiedades/ingreso` con `escenario = 'ARRENDADA'`, los datos del
propietario, de la propiedad y del inquilino actual, el sistema DEBE crear
(o reutilizar) al inquilino, asignarlo como inquilino actual (con su
historial de ocupación) y transicionar la instancia hasta el estado
`arrendada`, respondiendo 201 con la ficha.

### R3 — (RF-PI2, RF-C6) Propietario: crear si no existe, reutilizar si existe

CUANDO el ingreso recibe `propietario` como datos en línea, el sistema DEBE
buscar el perfil por `(tipo_documento, documento)` dentro del tenant; SI
existe y su nombre coincide con el recibido (criterio `nombresCoinciden` de
#26) ENTONCES el sistema DEBE reutilizarlo; SI no existe ENTONCES el sistema
DEBE crearlo; SI existe con otro nombre ENTONCES el sistema DEBE responder
409 `NOMBRE_NO_COINCIDE_CON_IDENTIDAD` sin escribir nada. SI el ingreso
recibe `perfil_propietario_id` en su lugar, el sistema DEBE usarlo tal cual
(404 si es inexistente o de otro tenant).

### R4 — (RF-PI2, RF-C6) Inquilino: crear si no existe, reutilizar si existe

CUANDO el escenario B recibe `inquilino` como datos en línea, el sistema
DEBE aplicar el mismo criterio de R3 (reutilizar por documento con nombre
coincidente, crear si no existe, 409 si el nombre diverge, 404 si el id es
ajeno).

### R5 — (RF-PI1) El escenario B exige inquilino

SI `escenario = 'ARRENDADA'` llega sin `inquilino` (ni datos en línea ni
id) ENTONCES el sistema DEBE responder 400 sin escribir nada.

### R6 — (RF-PI1, RF-P4) El ingreso es atómico

SI cualquier paso del ingreso falla (incluida la cadena de transiciones del
escenario B) ENTONCES el sistema DEBE abortar la petición completa con
rollback: ni propietario, ni propiedad, ni inquilino, ni transiciones
quedan escritos.

### R7 — (RF-P4) El estado final es el correcto

CUANDO el ingreso termina con éxito, el sistema DEBE dejar la instancia de
la propiedad en `disponible` (escenario A) o `arrendada` (escenario B),
verificable con consulta independiente.

---

## Grupo B — Auditoría del ingreso (RF-W4, §11.3)

### R8 — (RF-W4) Cada mutación crítica queda auditada

CUANDO el ingreso crea un propietario, un inquilino o una propiedad, o
ejecuta una transición del ciclo de vida, el sistema DEBE registrar la
entrada correspondiente en `audit_log` con `tenant_id`, `actor_id`,
`accion`, `entity_type` y `entity_id` del recurso afectado — aunque las
mutaciones ocurran dentro del servicio y no pasen por un controller.

### R9 — (RF-W4) La cadena de transiciones queda en el log del motor

CUANDO el escenario B transiciona la instancia, el sistema DEBE escribir
cada transición en `workflow_transicion_log` (append-only, actor en las
humanas), igual que si se hubieran ejecutado por la ficha.

---

## Grupo C — Invariantes de seguridad (obligatorios, `docs/specs.md`)

### R10 — (RF-A1, RF-C3) Aislamiento y autorización

SI una petición del tenant A intenta el ingreso reutilizando perfiles del
tenant B ENTONCES el sistema DEBE responder 404 sin revelar su existencia.
SI un usuario sin el rol requerido invoca `POST /propiedades/ingreso`
ENTONCES el sistema DEBE rechazar con 403 en el backend (401 sin token).

### R11 — (RF-C3, `docs/architecture.md`) Sin contexto de tenant, falla

SI un repositorio de esta feature se ejecuta sin contexto de tenant
establecido ENTONCES el sistema DEBE fallar con `SinContextoDeTenantError`.

### R12 — (§11.3, Ley 1581 de 2012) Datos personales fuera de logs

EL sistema NO DEBE incluir documentos, celulares, teléfonos, correos,
direcciones ni el contexto de las transiciones en el `metadata` de
`audit_log` ni en los logs de aplicación (los patrones de #7/#8).

---

## Grupo D — Gobernanza del cambio

### R13 — (C4/C6) Sin esquema nuevo y lista de rutas al día

EL sistema NO DEBE añadir ninguna tabla ni columna nueva (todo el ingreso
reutiliza las entidades de #5/#6/#7/#8): `TABLAS_PERMITIDAS` no cambia.
`RUTAS_PERMITIDAS` DEBE actualizarse con `POST /propiedades/ingreso` en el
mismo cambio. Si en el futuro hiciera falta una migración, DEBE ser única,
versionada, forward-only e idempotente.

### R14 — (docs/specs.md) Fronteras ancladas

EL sistema NO DEBE generar ni exigir el template de contrato (RF-PI3,
feature #16) ni digitalizar el contrato físico del escenario B (§13.4,
feature #18) en el ingreso: ambas quedan como dependencias registradas para
esas features, que extenderán el ingreso cuando existan.

---

## CRITERIOS DE ACEPTACIÓN del humano (feature_list.json #9)

| Criterio | R que lo satisface |
|---|---|
| Soporta el escenario A (propiedad vacante) y el escenario B (propiedad ya arrendada en migración) | R1, R2, R5 |
| Permite crear propietario o inquilino en línea si no existen | R3, R4 |
| Al terminar el ingreso, la propiedad queda en el estado correcto del ciclo de vida | R1, R2, R7 |

## DECISIONES que el humano confirma en la puerta del spec

| Id | Pregunta | Decisión propuesta | Motivo |
|---|---|---|---|
| **PA-9-1** | ¿RF-PI3 (template validado al terminar el ingreso)? | **Fuera de #9**: es la feature #16 (fase 1c). El ingreso termina en el estado correcto (R1/R2); #16 extenderá el flujo (R14) | La aceptación de #9 no lo incluye; #16 no existe aún |
| **PA-9-2** | ¿Contrato físico del escenario B? | **Fuera de #9**: es #18 (R14). El ingreso asocia inquilino y deja en `arrendada` | La digitalización es otra feature |
| **PA-9-3** | ¿Reutilización de perfiles existentes? | Por documento dentro del tenant, con comparación de nombre (criterio de #26): divergente → 409 sin escribir (R3, R4) | Consistencia con la deduplicación de identidad |
| **PA-9-4** | ¿Atomicidad? | El ingreso completo es una sola transacción (R6): cualquier fallo revierte todo | Un ingreso a medias deja la ficha y la máquina incoherentes |

**No quedan preguntas de producto abiertas** (las cuatro decisiones quedan
explícitas para la puerta del spec).
