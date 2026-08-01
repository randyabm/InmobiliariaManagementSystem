# Requirements — inventory_creation

> Feature #12. Creación del inventario con fotos.
> Anclaje al PRD: **RF-I1** (inventario por propiedad + tipo de evento),
> **RF-I3** (fotos en object storage, nunca en la base), **RF-I7** (estado
> visible), **RF-I13** (panel de administración), **RF-I24** (libertad
> ad-hoc en campo, snapshot que no altera la plantilla), **§8.7** (entidades
> Inventory/Zone/Item/Photo), **D2** (RLS), **RF-C3** (RBAC).

Notación EARS estricta (`docs/specs.md`). Un solo `DEBE` por requirement.

## Dependencias

- **#11 `inventory_templates` (done):** la plantilla se **materializa** aquí
  como snapshot (RF-I24, frontera anclada en R15 de #11).
- **#6 `property_profile` (done):** la propiedad (validación) y su `tipo`
  (resuelve la plantilla).
- **#6 `almacenamiento` (done):** MinIO para las fotos (RF-I3).

## Fronteras explícitas (qué NO es de #12)

- **Transiciones de estado del inventario** (Enviado → En revisión → En
  negociación → Acordado → Firmado → Cerrado, RF-I7): el envío y la
  revisión son **#13**; la firma y el PDF, **#14**. #12 crea el inventario
  en `Borrador` y lo lista.
- **Versionado (RF-I6) y comparación (RF-I10):** features **#22** y **#21**.
- **Notificaciones de cambio de estado (RF-I11):** la #10 (el hook existe);
  el disparo concreto lo declaran #13/#14.

---

## Grupo A — Esquema del inventario (§8.7, RF-I1, RF-I7)

### R1 — (RF-I1, D2) Tabla `inventario`

EL sistema DEBE persistir cada inventario en la tabla `inventario` con `id`,
`tenant_id` FK, `propiedad_id` FK, `tipo_evento` CHECK IN (`ENTREGA`,
`DEVOLUCION`), `estado` CHECK IN (`BORRADOR`, `ENVIADO`, `EN_REVISION`,
`EN_NEGOCIACION`, `ACORDADO`, `FIRMADO`, `CERRADO`) NOT NULL DEFAULT
`'BORRADOR'`, `creado_por` uuid FK, `created_at`, `updated_at`, con RLS
habilitado, forzado y política por `tenant_id` en la misma migración. Los
cambios de estado fuera de `BORRADOR` los hacen las features #13/#14; #12
solo crea y lista.

### R2 — (§8.7, RF-I24) Tablas `inventario_zona` e `inventario_item`

EL sistema DEBE persistir el snapshot de zonas e ítems en las tablas
`inventario_zona` (`id`, `tenant_id` FK, `inventario_id` FK, `nombre`,
`repetible` boolean, `orden`, `plantilla_zona_id` uuid NULL, `created_at`)
e `inventario_item` (`id`, `tenant_id` FK, `zona_id` FK, `nombre`,
`field_type` CHECK (los 6), `opciones_json` jsonb NULL, `estado_checklist`
CHECK IN (`BUENO`, `REGULAR`, `MALO`) NULL, `valor_respuesta` jsonb NULL,
`comentario` text NULL, `foto_obligatoria` boolean, `plantilla_item_id`
uuid NULL, `creado_offline` boolean NOT NULL DEFAULT false,
`sincronizado_en` timestamptz NULL, `created_at`, `updated_at`), ambas con
RLS por `tenant_id` en la misma migración.

### R3 — (RF-I3, §8.7) Tabla `inventario_item_foto`

EL sistema DEBE persistir las fotos de cada ítem en la tabla
`inventario_item_foto` (`id`, `tenant_id` FK, `item_id` FK, `clave_storage`
text NOT NULL, `hash_sha256` text NOT NULL, `autor` CHECK IN (`EMPLEADO`,
`INQUILINO`), `fecha_captura` timestamptz NOT NULL DEFAULT now()) con RLS
por `tenant_id`. El binario DEBE vivir en object storage (R5); la base solo
guarda la clave y el hash.

---

## Grupo B — Creación y materialización (RF-I1, RF-I24)

### R4 — (RF-I1, RF-I24) Crear el inventario materializando la plantilla

CUANDO un usuario con rol `admin` o `empleado` envía
`POST /inventarios` con `{ propiedad_id, tipo_evento }`, el sistema DEBE
validar la propiedad (404 si ajena/inexistente), resolver la plantilla del
`tipo` de la propiedad (copia TENANT si existe, si no SISTEMA), crear el
inventario en `BORRADOR` y copiar a `inventario_zona`/`inventario_item` las
zonas e ítems ACTIVOS de la plantilla, en la MISMA transacción. SI la
propiedad ya tiene un inventario `BORRADOR` del mismo `tipo_evento`
ENTONCES el sistema DEBE responder 409 `INVENTARIO_BORRADOR_YA_EXISTE`.

### R5 — (RF-I3) Subir y borrar fotos de un ítem

CUANDO un usuario autorizado envía `POST /inventarios/:id/items/:idItem/
fotos` (multipart) o `DELETE /inventarios/:id/items/:idItem/fotos/:idFoto`,
el sistema DEBE almacenar el binario en object storage (clave
`uuid + extensión`, hash SHA-256 verificado) y registrar la fila, o borrar
la fila (baja lógica) sin borrar el objeto. El binario NO DEBE quedar en la
base (R3).

### R6 — (RF-I24) Libertad ad-hoc en campo

CUANDO un usuario autorizado invoca los endpoints de gestión del
inventario (`POST/PATCH/DELETE` de zonas y ítems, `PATCH` para reordenar),
el sistema DEBE aplicar el cambio SOLO al snapshot del inventario y NO
DEBE modificar la plantilla de origen (RF-I24). Las respuestas de los ítems
(`estado_checklist`, `valor_respuesta`, `comentario`) se escriben por
`PATCH` sobre el ítem.

### R7 — (RF-I7, RF-I13) Estado visible y panel de administración

CUANDO un usuario autorizado invoca `GET /inventarios` (con filtros
`propiedad_id`, `estado`, `tipo_evento`) o `GET /inventarios/:id`, el
sistema DEBE responder 200 con la lista (o la ficha con sus zonas e ítems)
y el estado; el estado `BORRADOR` es el único que #12 puede ver para
edición estructural (las transiciones son de #13/#14).

---

## Grupo C — Invariantes de seguridad (obligatorios, `docs/specs.md`)

### R8 — (RF-A1, RF-C3) Aislamiento y autorización

SI una petición autenticada en el tenant A consulta o modifica un
inventario, zona, ítem o foto del tenant B ENTONCES el sistema DEBE
responder 404 sin revelar su existencia. SI un usuario sin el rol requerido
invoca los endpoints DEBE responder 403 (401 sin token). La gestión
estructural y de fotos DEBE ser de `admin`/`empleado`.

### R9 — (RF-C3, `docs/architecture.md`) Sin contexto de tenant, falla

SI un repositorio de esta feature se ejecuta sin contexto de tenant
establecido ENTONCES el sistema DEBE fallar con `SinContextoDeTenantError`.

### R10 — (RF-W4, §11.3, Ley 1581) Auditoría y PII

CUANDO se crea un inventario o se sube una foto, el sistema DEBE registrar
la entrada en `audit_log` con `tenant_id`, `actor_id`, `accion`,
`entity_type` y `entity_id`, con `metadata` vacío; los comentarios de los
ítems NO DEBEN aparecer en logs ni en `audit_log.metadata`.

---

## Grupo D — Gobernanza del cambio

### R11 — (D2, `docs/conventions.md`, C4/C6) Migración versionada y listas al día

EL sistema DEBE aplicar los cambios de esquema en una única migración
versionada, forward-only e idempotente (previsiblemente
`0016_inventory_creation.sql`), y `TABLAS_PERMITIDAS` (+4) y
`RUTAS_PERMITIDAS` (+12) DEBEN actualizarse en el mismo cambio.

---

## CRITERIOS DE ACEPTACIÓN del humano (feature_list.json #12)

| Criterio | R que lo satisface |
|---|---|
| Se crea un inventario asociado a propiedad y tipo de evento (entrega/devolución) | R1, R4 |
| La plantilla se materializa como snapshot: editarla después no altera inventarios existentes | R4 (copiado en la transacción) + test |
| El empleado tiene libertad total para agregar, eliminar y reordenar zonas e ítems en campo | R6 |
| Fotos múltiples por ítem almacenadas en object storage, nunca en la base de datos | R3, R5 |
| El inventario tiene estado visible y un panel de administración lo lista | R1, R7 |

## DECISIONES que el humano confirma en la puerta del spec

| Id | Pregunta | Decisión propuesta | Motivo |
|---|---|---|---|
| **PA-12-1** | ¿El estado del inventario vive en el motor de workflows (#7) o en una columna? | **Columna con CHECK** (R1): los 7 estados del §8.7; las transiciones (Enviado→…) las ejecutan #13/#14 sobre esta columna | El motor es para procesos de negocio transversales; el ciclo del inventario es un estado de entidad con fronteras ya repartidas entre #13/#14 |
| **PA-12-2** | ¿Un borrador por propiedad y tipo de evento? | **Sí**: 409 `INVENTARIO_BORRADOR_YA_EXISTE` (R4) | Evita inventarios huérfanos duplicados; el empleado edita el mismo borrador |
| **PA-12-3** | ¿La resolución de la plantilla? | La del `tipo` de la propiedad: copia TENANT si existe, si no SISTEMA (mismo criterio PA-8-3) | La personalización del tenant aplica al inventario |
| **PA-12-4** | ¿El borrado de fotos? | Baja lógica de la fila; el objeto NO se borra (trazabilidad) | Mismo criterio que `propiedad_documento` (#6) |

**No quedan preguntas de producto abiertas** (las cuatro decisiones quedan
explícitas para la puerta del spec).
