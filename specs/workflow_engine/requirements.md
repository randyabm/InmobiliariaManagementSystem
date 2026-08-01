# Requirements — workflow_engine

> Feature #7. Motor de workflows dirigido por datos.
> Anclaje al PRD: **RF-W1** (máquinas de estado con condiciones y
> responsables), **RF-W2** (personalización del admin), **RF-W3** (transición
> puede disparar notificaciones — frontera con #10), **RF-W4** (auditoría de
> cada transición), **RF-W5** (pasos humanos y automáticos), **RF-A4**
> (genérico y reutilizable entre módulos), **RF-P4** y §12.2 (el ciclo de
> vida de la propiedad como primer consumidor), **D3** (tablas de definición
> + instancias + log de transiciones; JSONB), **D2** (RLS).

Notación EARS estricta (`docs/specs.md`). Un solo `DEBE` por requirement.

## Dependencias

- **#27 (done):** toda ruta protegida pasa por la validación de sesión
  existente; no se toca.
- **#3 (done):** `user_role`, RBAC. El motor valida los responsables de cada
  transición contra `user_role.activo` **en la base** (fresco, no del token).
- **#4 (done):** `AuditService` para las acciones críticas del motor.
- **#6 (done):** el primer consumidor real es la definición sembrada del
  ciclo de vida de la propiedad (RF-P4); el #8 la usará para transicionar.

## Fronteras explícitas (qué NO es de #7)

- **Ejecutar notificaciones (RF-W3):** es la feature **#10** `notifications`.
  #7 deja el **hook declarativo** (la transición puede declarar
  `notificacion` como dato) y nada más: nadie envía nada aquí.
- **Límites por paquete y versionado de paquetes (RF-W2 completo, RF-A5):**
  #7 entrega la personalización base (clonar la plantilla del sistema y
  editar la copia del tenant). Los límites por paquete y el versionado
  viven en la feature de paquetes del tenant, que no tiene ficha.
- **Validar que la entidad existe (p. ej. que `propiedad_id` sea real):**
  es del módulo de negocio (el #8). El motor trata `entidad_tipo` /
  `entidad_id` como opacos; la unicidad impide dos instancias de la misma
  definición sobre la misma entidad.
- **El ciclo de vida de la propiedad en sí (RF-P4/P5):** el #8
  `property_lifecycle` consume el motor; #7 solo siembra su definición como
  datos de demostración (R15).

---

## Grupo A — Esquema de definición (los datos, no el código)

### R1 — (RF-W1, D3) Tabla `workflow_definicion`

EL sistema DEBE persistir cada definición de workflow en la tabla
`workflow_definicion` con `id`, `tenant_id` FK, `nombre`, `tipo` (clave
estable del proceso, p. ej. `ciclo_vida_propiedad`), `origen` CHECK IN
(`SISTEMA`, `TENANT`), `version` integer NOT NULL DEFAULT 1, `activo`
boolean NOT NULL DEFAULT true, `created_at`, `updated_at`, con UNIQUE
(`tenant_id`, `tipo`).

### R2 — (RF-W1, D3, RF-A4) Tablas `workflow_estado` y `workflow_transicion`

EL sistema DEBE persistir los estados y transiciones de cada definición
como filas, con:

- `workflow_estado`: `id`, `definicion_id` FK, `clave` (única dentro de la
  definición), `etiqueta`, `es_inicial` boolean, `es_final` boolean,
  `orden`, `created_at`.
- `workflow_transicion`: `id`, `definicion_id` FK, `origen_estado_id` FK,
  `destino_estado_id` FK, `clave` (única por definición y estado origen),
  `tipo_ejecucion` CHECK IN (`HUMANA`, `AUTOMATICA`), `roles_requeridos`
  text[] NOT NULL DEFAULT `{}`, `condicion` jsonb NOT NULL DEFAULT `{}`,
  `notificacion` jsonb NOT NULL DEFAULT `{}`, `orden` integer, `activo`
  boolean NOT NULL DEFAULT true, `created_at`.

y RLS habilitado, forzado y política por `tenant_id` en las tres tablas de
definición, en la misma migración que las crea (R13).

> RF-A4: ninguna lógica de negocio puede hardcodear una máquina de estados:
> si aparece un `switch` de estados en un módulo, debe expresarse como datos
> sobre este motor.

### R3 — (RF-W1) Condiciones como datos, evaluadas sin eval

CUANDO el motor evalúa la `condicion` de una transición, el sistema DEBE
interpretarla como cláusulas JSONB estructuradas (`campo`, `operador`,
`valor`) evaluadas por un evaluador whitelisted sobre el `contexto` de la
instancia — con operadores `igual`, `distinto`, `es_nulo`, `no_nulo`,
`mayor_que`, `menor_que` — y NO DEBE ejecutar JavaScript ni SQL dinámico
derivado de la condición.

### R4 — (RF-W2, PA-7-4) Clonar la plantilla del sistema

CUANDO un usuario con rol `admin` invoca `POST /workflows/:id/clonar`, el
sistema DEBE copiar la definición (estados y transiciones) a una definición
nueva del tenant (`origen = 'TENANT'`) y responder 201 con su id. SI la
definición origen es de otro tenant ENTONCES el sistema DEBE responder 404.
SI el tenant ya tiene una definición del mismo `tipo` ENTONCES el sistema
DEBE responder 409 sin escribir nada.

### R5 — (RF-W2, PA-7-4) Editar la copia del tenant

CUANDO un usuario con rol `admin` invoca `POST /workflows/:id/transiciones`
(añadir) o `DELETE /workflows/:idDefinicion/transiciones/:idTransicion`
(baja lógica) sobre una definición `origen = 'TENANT'`, el sistema DEBE
aplicar el cambio. SI la definición es de otro tenant ENTONCES el sistema
DEBE responder 404. SI es `origen = 'SISTEMA'` ENTONCES el sistema DEBE
responder 409 `DEFINICION_SISTEMA_NO_EDITABLE` sin escribir nada.

---

## Grupo B — Instancias y ejecución

### R6 — (RF-W1) Crear una instancia

CUANDO un usuario con rol `admin` o `empleado` invoca
`POST /workflows/:id/instancias` con `{ entidad_tipo, entidad_id,
contexto }`, el sistema DEBE crear la instancia en el estado inicial de la
definición y responder 201. SI ya existe una instancia de esa definición
para esa entidad ENTONCES el sistema DEBE responder 409
`INSTANCIA_YA_EXISTE`. 404 si la definición no existe o es de otro tenant.

### R7 — (RF-W1, RF-W5) Ejecutar una transición humana

CUANDO un usuario autorizado invoca
`POST /workflows/instancias/:idInstancia/transiciones/:idTransicion`, el
sistema DEBE validar que la transición pertenece a la definición de la
instancia, que su estado origen es el estado actual, que está `activo`, que
su `condicion` se cumple sobre el contexto y que el actor tiene alguno de
los `roles_requeridos` (comprobado contra `user_role.activo` en la base);
SI alguna validación falla ENTONCES el sistema DEBE responder 403 (rol) o
409 `TRANSICION_NO_DISPONIBLE` (el resto) sin cambiar el estado, y NO DEBE
revelar cuál de las condiciones falló.

### R8 — (RF-W5) Transiciones automáticas en cascada

CUANDO una transición humana lleva la instancia a un estado con
transiciones `AUTOMATICA` cuya condición se cumple, el sistema DEBE
ejecutarlas en la misma transacción de la petición, en orden, y continuar
en cascada hasta que ninguna aplique. SI la cadena excede 10 transiciones
automáticas consecutivas ENTONCES el sistema DEBE abortar con 409
`CICLO_AUTOMATICO` y deshacer todo (la transición humana incluida).

### R9 — (RF-W1) Consultar el estado y las transiciones disponibles

CUANDO un usuario autorizado invoca `GET /workflows/instancias/:idInstancia`,
el sistema DEBE responder 200 con el estado actual y la lista de
transiciones **humanas** disponibles para el actor (estado origen correcto,
`activo`, condición cumplida y rol autorizado). 404 si la instancia no
existe o es de otro tenant.

### R10 — (RF-W4, D3) Log de transiciones append-only

CUANDO una transición (humana o automática) se ejecuta, el sistema DEBE
registrar una fila en `workflow_transicion_log` con `instancia_id`,
`transicion_id`, `desde_estado_id`, `hacia_estado_id`, `actor_id` (o NULL en
las automáticas), `automatica`, `contexto_tras` y `created_at`. La tabla DEBE
ser inmutable desde la aplicación: los triggers impiden UPDATE y DELETE.

### R11 — (RF-W4, RF-W1) Historial consultable

CUANDO un usuario autorizado invoca
`GET /workflows/instancias/:idInstancia/historial`, el sistema DEBE
responder 200 con el log de la instancia ordenado por `created_at`
ascendente (la línea de tiempo de la máquina).

### R12 — (RF-A4) Instancias por entidad

EL sistema DEBE garantizar a lo sumo una instancia de una definición por
`(tenant_id, definicion_id, entidad_tipo, entidad_id)` (UNIQUE): una entidad
no puede estar en dos estados de la misma máquina.

---

## Grupo C — Invariantes de seguridad (obligatorios, `docs/specs.md`)

### R13 — (RF-A1, D2, PA-7-1) Aislamiento de las definiciones del sistema

EL sistema DEBE guardar las plantillas base (`origen = 'SISTEMA'`) en la
misma tabla con un `tenant_id` reservado
(`00000000-0000-0000-0000-000000000000`) y la política RLS DEBE permitir su
lectura por cualquier tenant (`tenant_id = contexto OR tenant_id = reservado`)
pero su escritura SOLO desde el contexto del tenant (`WITH CHECK`); la
aplicación NO DEBE escribir filas del sistema (verificado por test).

### R14 — (RF-A1, RF-C3) Aislamiento y autorización

SI una petición autenticada en el tenant A solicita, ejecuta o modifica una
definición, instancia o log del tenant B ENTONCES el sistema DEBE responder
404 sin revelar su existencia. SI un usuario sin el rol requerido invoca
cualquier endpoint del motor ENTONCES el sistema DEBE rechazar con 403 en
el backend.

### R15 — (RF-W4, RF-C3, `docs/architecture.md`) Sin contexto de tenant, falla

SI un repositorio de esta feature se ejecuta sin contexto de tenant
establecido ENTONCES el sistema DEBE fallar con `SinContextoDeTenantError`.
Toda transición y toda creación de instancia DEBEN registrar su entrada en
`audit_log` (RF-W4) con `tenant_id`, `actor_id`, `accion`, `entity_type` y
`entity_id`, sin datos personales en `metadata`.

### R16 — (§11.3) Datos personales fuera de logs

EL sistema NO DEBE incluir documentos, celulares, teléfonos, correos ni
nombres completos en el `metadata` de `audit_log`. El `contexto` de la
instancia es dato de dominio y vive en la base (R10); los logs de aplicación
NO DEBEN volcarlo.

---

## Grupo D — Gobernanza del cambio

### R17 — (D2, `docs/conventions.md`, C4/C6) Migración versionada y sembrada

EL sistema DEBE aplicar todos los cambios de esquema de esta feature en una
única migración versionada, forward-only e idempotente (la siguiente libre,
previsiblemente `0013_workflow_engine.sql`), que además **siembre como
datos** la definición `ciclo_vida_propiedad` del RF-P4 (estados
`disponible`, `en_checkeo`, `con_aseguradora`, `arrendada`,
`en_desocupacion`, `inactiva`; transiciones humanas lineales y la rama
condicional de retorno del RF-P4, con `condicion` como datos), y las listas
de control (`TABLAS_PERMITIDAS`, `RUTAS_PERMITIDAS`) DEBEN actualizarse en
el mismo cambio.

---

## CRITERIOS DE ACEPTACIÓN del humano (feature_list.json #7)

| Criterio | R que lo satisface |
|---|---|
| Estados, transiciones, condiciones y responsables se definen como datos, no como código | R1, R2, R3, R17 (seed como datos) |
| Existen entidades de definición e instancia de workflow | R1, R2, R6 |
| Cada transición queda auditada con actor y timestamp | R10, R11, R15 |
| Soporta pasos con intervención humana y pasos automáticos | R7, R8 |
| Existe un test que ejercita una máquina de estados completa definida solo con datos | R17 (seed) + test del bloque 2 |

## DECISIONES que el humano confirma en la puerta del spec

| Id | Pregunta | Decisión propuesta | Motivo |
|---|---|---|---|
| **PA-7-1** | ¿Dónde viven las plantillas del sistema? | Misma tabla con `tenant_id` reservado y política RLS con OR de lectura + `WITH CHECK` de escritura propia | Una sola tabla, un solo régimen; la escritura de filas del sistema queda bloqueada por el motor (R13) |
| **PA-7-2** | ¿Cómo se evalúan las condiciones? | Cláusulas JSONB whitelisted sobre el contexto (sin eval de JS ni SQL) | Seguridad y determinismo (R3) |
| **PA-7-3** | ¿Transiciones automáticas? | En cascada en la misma transacción, máx. 10 consecutivas → 409 y rollback total | RF-W5 sin procesos asíncronos inventados (R8) |
| **PA-7-4** | ¿Alcance de RF-W2? | Clonar plantilla + añadir/baja transiciones en la copia del tenant; límites por paquete y versionado (RF-A5) quedan para la feature de paquetes | RF-W2 completo necesita el concepto de paquete, que no tiene ficha |

**No quedan preguntas de producto abiertas** (las cuatro decisiones quedan
explícitas para la puerta del spec).
