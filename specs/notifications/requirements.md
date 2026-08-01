# Requirements — notifications

> Feature #10. Motor de notificaciones asíncronas.
> Anclaje al PRD: **RF-N1** (notificaciones automáticas en transiciones
> relevantes), **RF-N2** (recordatorios automáticos), **RF-W3** (la
> transición puede disparar notificaciones), **RF-C4** (el
> `medio_preferido_contacto` del inquilino lo usa este motor), **RF-W4** y
> §11.3 (auditoría), **§11** (cola de notificaciones asíncronas), **D2**
> (RLS), §6.4.

Notación EARS estricta (`docs/specs.md`). Un solo `DEBE` por requirement.

## Dependencias

- **#7 `workflow_engine` (done):** el hook declarativo `notificacion` de las
  transiciones (dato JSONB, nunca ejecutado por #7). Esta feature lo
  consume (R2).
- **#5 (done):** `perfil_inquilino.medio_preferido_contacto`,
  `email_contacto`, `celular` y `perfil_propietario` — la resolución de
  destinatarios (R7).
- **#27 (done):** guards y sesión en las rutas nuevas.

## Fronteras explícitas (qué NO es de #10)

- **Proveedores reales de email/SMS/WhatsApp:** el PRD §11 los marca «a
  integrar». #10 entrega la **interfaz abstracta** y un **proveedor de
  registro** (persiste en `notificacion_enviada`); los proveedores
  concretos se enchufan detrás de la interfaz (mismo patrón que la firma,
  #14) cuando existan credenciales (PA-10-2).
- **Recordatorios específicos** (p. ej. «inquilino no revisó el inventario
  en X días»): el motor de recordatorios (R10-R12) es genérico; el recordatorio
  concreto lo programa la feature **#13** (frontera, R13).
- **Contenido de plantillas:** el hook lleva `plantilla` como dato; el motor
  renderiza sustitución mínima de variables (`{entidad}`, `{estado}`) y NO
  gestiona una librería de plantillas (eso sería inventar producto).

---

## Grupo A — El outbox transaccional (RF-W3)

### R1 — (D2) Tabla `notificacion_pendiente`

EL sistema DEBE persistir cada notificación por enviar en la tabla
`notificacion_pendiente` (id, `tenant_id` FK, `canal`, `destinatario`,
`plantilla`, `contenido` jsonb, `entidad_tipo`, `entidad_id`,
`transicion_id` NULL, `estado` CHECK IN (`PENDIENTE`, `PROCESADA`,
`FALLIDA`), `intentos` integer NOT NULL DEFAULT 0, `error` text NULL,
`created_at`, `procesada_en` NULL) con RLS habilitado, forzado y política
por `tenant_id` en la misma migración.

### R2 — (RF-W3, PA-10-4) El gancho de la transición es transaccional

CUANDO el motor ejecuta una transición cuya `notificacion` no está vacía,
el sistema DEBE escribir la fila del outbox (R1) en la MISMA transacción de
la petición; SI la transición revierte ENTONCES la fila del outbox DEBE
revertir también. CUANDO la `notificacion` está vacía, el sistema NO DEBE
escribir nada.

> La entrega de la notificación nunca condiciona la semántica de la
> transición: el outbox se llena o revierte con ella, y el envío ocurre
> después (R3).

### R3 — (RF-N1, PA-10-1) El procesador despacha el outbox

CUANDO el procesador de notificaciones corre, el sistema DEBE tomar las
filas `PENDIENTE` (una a una, cada una con `SET LOCAL app.current_tenant`
de su tenant), resolver destinatario y canal (R7), despachar por el
proveedor de la interfaz (R5) y marcar `PROCESADA` (o `FALLIDA` con `error`
y `intentos` incrementado, sin datos personales en el error).

### R4 — (RF-N1) Reintentos acotados

SI una fila del outbox falla, el sistema DEBE permitir su reprocesamiento
mientras `intentos < 3`; al alcanzar 3, DEBE quedar `FALLIDA` definitiva y
visible en el listado (R9), sin reintento automático.

---

## Grupo B — Envío y auditoría (RF-N1, RF-W4)

### R5 — (PRD §11) Proveedores tras una interfaz

EL sistema DEBE despachar las notificaciones a través de una interfaz
abstracta `ProveedorNotificaciones` (`enviar(destinatario, canal,
contenido)`) y DEBE incluir un `ProveedorRegistro` que persiste la entrega
en `notificacion_enviada` (R6). Los proveedores reales (email/SMS/WhatsApp)
se registran tras la misma interfaz sin tocar el procesador.

### R6 — (RF-W4) `notificacion_enviada` append-only

EL sistema DEBE persistir cada entrega en la tabla `notificacion_enviada`
(id, `tenant_id` FK, `canal`, `destinatario`, `entidad_tipo`,
`entidad_id`, `plantilla`, `contenido` jsonb, `estado`, `created_at`) con
RLS y triggers que impiden UPDATE y DELETE (append-only, patrón
`audit_log`): la historia de lo enviado es inmutable.

### R7 — (RF-C4) Destinatario y canal

CUANDO el hook declara `destinatario.tipo = 'inquilino_actual'` o
`'propietario_principal'`, el sistema DEBE resolver el perfil desde la
entidad de la instancia; CUANDO declara `email` o `celular` directos, DEBE
usarlos. El canal DEBE ser el del hook si lo declara; si no, el
`medio_preferido_contacto` del perfil (RF-C4). SI el perfil no existe o no
tiene el canal DEBE marcar la fila `FALLIDA` sin lanzar al motor.

### R8 — (RF-N1) Envío manual

CUANDO un usuario con rol `admin` o `empleado` envía
`POST /notificaciones` con `{ destinatario, canal?, contenido }`, el
sistema DEBE crear la fila del outbox y responder 201 con su id; el
procesador la entrega por el mismo camino que las de transición.

### R9 — (RF-W4) Listado de entregas

CUANDO un usuario autorizado invoca `GET /notificaciones`, el sistema DEBE
responder 200 con las entregas (`notificacion_enviada`) y los pendientes
del tenant de la petición, ordenados por `created_at` descendente.

---

## Grupo C — Recordatorios programados (RF-N2)

### R10 — (D2) Tabla `notificacion_programada`

EL sistema DEBE persistir los recordatorios en la tabla
`notificacion_programada` (id, `tenant_id` FK, `programada_para`
timestamptz NOT NULL, `estado` CHECK IN (`PENDIENTE`, `EJECUTADA`,
`CANCELADA`), `destinatario`, `canal`, `plantilla`, `contenido` jsonb,
`entidad_tipo`, `entidad_id`, `created_at`, `ejecutada_en` NULL) con RLS
habilitado, forzado y política por `tenant_id` en la misma migración.

### R11 — (RF-N2) Crear, listar y cancelar recordatorios

CUANDO un usuario con rol `admin` o `empleado` invoca
`POST /notificaciones/programadas` (con `programada_para` y los datos de
envío), el sistema DEBE crear el recordatorio y responder 201; `GET
/notificaciones/programadas` DEBE listar los del tenant; `DELETE
/notificaciones/programadas/:id` DEBE cancelarlos (marcar `CANCELADA`, sin
borrado físico).

### R12 — (RF-N2) Ejecutar los vencidos

CUANDO el procesador corre, el sistema DEBE tomar los recordatorios con
`programada_para <= now()` y `estado = 'PENDIENTE'`, despacharlos por el
mismo camino (R3/R7) y marcarlos `EJECUTADA`.

### R13 — (RF-N2 frontera) Los recordatorios específicos los crean sus módulos

EL sistema NO DEBE crear aquí el recordatorio «inquilino no revisó el
inventario en X días»: lo creará la feature **#13** sobre este motor
(R10-R12).

---

## Grupo D — Invariantes de seguridad (obligatorios, `docs/specs.md`)

### R14 — (RF-A1, RF-C3) Aislamiento y autorización

SI una petición autenticada en el tenant A consulta o cancela filas de
`notificacion_enviada`, `notificacion_pendiente` o
`notificacion_programada` del tenant B ENTONCES el sistema DEBE responder
404 sin revelar su existencia. SI un usuario sin el rol requerido invoca
los endpoints DEBE responder 403 (401 sin token). El procesador DEBE
procesar cada fila bajo el `SET LOCAL` de SU tenant.

### R15 — (§11.3, Ley 1581 de 2012) Datos personales fuera de logs

EL sistema NO DEBE incluir el `contenido`, los correos ni los celulares de
las notificaciones en los logs de aplicación ni en el `metadata` de
`audit_log`; el contenido vive en las tablas de dominio y el error del
outbox NO DEBE contener el contenido ni el destinatario.

### R16 — (RF-C3, `docs/architecture.md`) Sin contexto de tenant, falla

SI un repositorio de esta feature se ejecuta sin contexto de tenant
establecido ENTONCES el sistema DEBE fallar con `SinContextoDeTenantError`.

---

## Grupo E — Gobernanza del cambio

### R17 — (D2, `docs/conventions.md`, C4/C6) Migración versionada y listas al día

EL sistema DEBE aplicar los cambios de esquema en una única migración
versionada, forward-only e idempotente (previsiblemente
`0014_notifications.sql`), y `TABLAS_PERMITIDAS` (+3) y `RUTAS_PERMITIDAS`
(+5) DEBEN actualizarse en el mismo cambio.

### R18 — (RF-W3, C3) El gancho no cambia la semántica del motor

CUANDO una transición con hook se ejecuta, el sistema NO DEBE alterar el
resultado de la transición por el estado de la notificación: el outbox se
escribe en la misma transacción (R2) y todo lo demás queda igual
(verificado: una transición con hook fallido de entrega sigue marcando su
log de dominio).

---

## CRITERIOS DE ACEPTACIÓN del humano (feature_list.json #10)

| Criterio | R que lo satisface |
|---|---|
| Las notificaciones se procesan en cola, fuera del ciclo de la petición | R1, R2, R3 (outbox + procesador) |
| Respetan el medio preferido de contacto del destinatario | R7 |
| Una transición de workflow puede disparar una notificación de forma declarativa | R2, R18 |
| Existen recordatorios programados | R10, R11, R12 |
| Los proveedores externos son intercambiables tras una interfaz | R5, R6 |

## DECISIONES que el humano confirma en la puerta del spec

| Id | Pregunta | Decisión propuesta | Motivo |
|---|---|---|---|
| **PA-10-1** | ¿Cola con BullMQ/Redis (PRD §11) o outbox transaccional? | **Outbox en la base + procesador en proceso** (cada 60 s, invocable): la fila se escribe y revierte CON la transición (R2), y el test es determinista sin infra nueva | BullMQ añade Redis como dependencia dura de runtime; el outbox da atomicidad que BullMQ no da; si la escala lo exige, el procesador se mueve a un worker detrás de la misma tabla |
| **PA-10-2** | ¿Proveedores reales? | **Interfaz + `ProveedorRegistro`** (persiste en `notificacion_enviada`) como único proveedor MVP; email/SMS/WhatsApp se enchufan detrás de la interfaz cuando existan credenciales | No hay SMTP ni APIs externas en el entorno; el patrón es el mismo que la firma (#14) |
| **PA-10-3** | ¿Quién es el destinatario y el canal? | El hook declara `destinatario` (tipo resuelto de la entidad, o email/celular directos); el canal es el del hook o el `medio_preferido_contacto` del perfil (RF-C4) | RF-C4 fija que ese campo lo usa este motor |
| **PA-10-4** | ¿Dónde se engancha el disparo? | En `WorkflowService`, tras cada transición con `notificacion` no vacía: escribir el outbox en la misma transacción; sin cambiar la semántica del motor (R18) | El hook ya es dato de #7; el consumo es de #10 |

**No quedan preguntas de producto abiertas** (las cuatro decisiones quedan
explícitas para la puerta del spec).
