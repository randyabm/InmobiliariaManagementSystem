# Requirements — inventory_templates

> Feature #11. Plantillas de inmuebles (zonas e ítems).
> Anclaje al PRD: **RF-I2** (estructura configurable de zonas e ítems),
> **RF-I22** (gestión por tenant: clonar y editar), **RF-I23** (tipos de
> campo y zonas repetibles), **§8.8** (jerarquía, catálogo base, herencia en
> cascada), **RF-I24** (frontera: la materialización es del inventario),
> **D2** (RLS), **RF-C3** (RBAC).

Notación EARS estricta (`docs/specs.md`). Un solo `DEBE` por requirement.

## Dependencias

- **#6 `property_profile` (done):** el enum `TipoPropiedad`
  (APARTAMENTO/CASA/LOCAL/OFICINA/BODEGA/PARQUEADERO) — el catálogo base se
  alinea 1:1 con los tipos de propiedad.
- **#7 `workflow_engine` (done):** el patrón de plantillas del sistema con
  tenant reservado + RLS con OR/WITH CHECK se **reutiliza** (PA-11-1), no se
  reinventa.

## Fronteras explícitas (qué NO es de #11)

- **Materialización del inventario (RF-I24, US-02, §8.8 nivel 3):** copiar
  la plantilla vigente a zonas/ítems del inventario y la libertad ad-hoc del
  empleado en campo son la feature **#12 `inventory_creation`**. #11 deja la
  plantilla lista como molde (PA-11-3).
- **Formato de contingencia en papel (RF-I19):** es la feature **#14**
  (y §10.5); reutilizará la plantilla.
- **Fotos (RF-I3):** los ítems declaran `foto_obligatoria` como dato; subir
  fotos es del inventario (#12).

---

## Grupo A — Esquema de la plantilla (§8.8.1, RF-I23)

### R1 — (RF-I22, D2, §8.8) Tabla `plantilla_inmueble`

EL sistema DEBE persistir cada plantilla en la tabla `plantilla_inmueble`
con `id`, `tenant_id` FK, `tipo` CHECK IN (`APARTAMENTO`, `CASA`, `LOCAL`,
`OFICINA`, `BODEGA`, `PARQUEADERO`), `nombre`, `origen` CHECK IN
(`SISTEMA`, `TENANT`), `version` integer NOT NULL DEFAULT 1, `activo`
boolean NOT NULL DEFAULT true, `created_at`, `updated_at`, con UNIQUE
(`tenant_id`, `tipo`) y RLS habilitado, forzado y política por `tenant_id`
en la misma migración. Las plantillas del sistema usan el `tenant_id`
reservado `00000000-0000-0000-0000-000000000000` con la política RLS
`USING (tenant_id = contexto OR tenant_id = reservado)` y `WITH CHECK`
propio (patrón #7, PA-11-1).

### R2 — (§8.8.3, RF-I23) Tabla `plantilla_zona`

EL sistema DEBE persistir las zonas en la tabla `plantilla_zona` (`id`,
`plantilla_id` FK, `nombre`, `repetible` boolean NOT NULL DEFAULT false,
`obligatoria` boolean NOT NULL DEFAULT false, `orden` integer NOT NULL
DEFAULT 0, `activo` boolean NOT NULL DEFAULT true, `created_at`, UNIQUE
(`plantilla_id`, `nombre`)) con RLS por `tenant_id` (a través de su
plantilla) en la misma migración.

### R3 — (§8.8.2, RF-I23) Tabla `plantilla_item`

EL sistema DEBE persistir los ítems en la tabla `plantilla_item` (`id`,
`zona_id` FK, `nombre`, `field_type` CHECK IN (`estado`, `si_no`,
`si_no_estado`, `conteo`, `seleccion`, `texto`), `opciones_json` jsonb NULL,
`obligatorio` boolean NOT NULL DEFAULT false, `foto_obligatoria` boolean
NOT NULL DEFAULT false, `orden` integer NOT NULL DEFAULT 0, `activo`
boolean NOT NULL DEFAULT true, `created_at`, UNIQUE (`zona_id`, `nombre`))
con RLS por `tenant_id` (a través de su plantilla) en la misma migración.

---

## Grupo B — Catálogo base y clonado (§8.8.4, §8.8.5, RF-I22)

### R4 — (RF-I22, §8.8.5, PA-11-2) Semilla del catálogo base

CUANDO la migración se aplica, el sistema DEBE sembrar (idempotente) las
seis plantillas base `origen = 'SISTEMA'` (APARTAMENTO, CASA, LOCAL,
OFICINA, BODEGA, PARQUEADERO); la de APARTAMENTO DEBE incluir el ejemplo
completo del PRD §8.8.5 (Sala, Cocina, Habitación repetible, Baño
repetible, Entrega de llaves — con sus ítems y `field_type`/banderas); las
otras cinco DEBEN crearse sin zonas (el PRD no las enumera y no se inventa
producto).

### R5 — (RF-I22) Clonar una plantilla

CUANDO un usuario con rol `admin` invoca `POST /plantillas/:id/clonar`, el
sistema DEBE copiar la plantilla (zonas e ítems activos) a una definición
nueva del tenant (`origen = 'TENANT'`) y responder 201 con su id. SI la
plantilla es de otro tenant ENTONCES el sistema DEBE responder 404. SI el
tenant ya tiene una plantilla del mismo `tipo` ENTONCES el sistema DEBE
responder 409 sin escribir nada.

### R6 — (RF-I22) La plantilla del sistema no se edita

CUANDO una petición de gestión (zonas o ítems) apunta a una plantilla
`origen = 'SISTEMA'`, el sistema DEBE responder 409
`PLANTILLA_SISTEMA_NO_EDITABLE` sin escribir nada; a una plantilla ajena,
404.

---

## Grupo C — Gestión de la copia del tenant (RF-I22, RF-I23)

### R7 — (RF-I22) CRUD de zonas

CUANDO un usuario con rol `admin` invoca `POST /plantillas/:id/zonas`,
`PATCH /plantillas/:id/zonas/:idZona` o
`DELETE /plantillas/:id/zonas/:idZona` sobre una plantilla `TENANT`, el
sistema DEBE crear, actualizar o dar de baja lógica (`activo = false`) la
zona respectivamente, y NO DEBE ejecutar un borrado físico. Los ítems de
una zona inactiva quedan inertes (no se listan).

### R8 — (RF-I23) CRUD de ítems

CUANDO un usuario con rol `admin` invoca `POST`, `PATCH` o `DELETE` sobre
`/plantillas/:id/zonas/:idZona/items(/ :idItem)`, el sistema DEBE crear,
actualizar o dar de baja lógica el ítem con su `field_type` y banderas.

### R9 — (RF-I23) Las opciones son solo de `seleccion`

SI un ítem declara `opciones_json` con `field_type != 'seleccion'`, o
`field_type = 'seleccion'` sin opciones, ENTONCES el sistema DEBE responder
400 sin escribir nada (el CHECK del motor lo respalda).

### R10 — (RF-I23) Zonas repetibles y obligatorias

CUANDO se listan las plantillas completas, el sistema DEBE exponer
`repetible` y `obligatoria` de cada zona y las banderas
`obligatorio`/`foto_obligatoria` de cada ítem, de modo que #12 pueda
instanciar zonas N veces y validar respuestas.

---

## Grupo D — Invariantes de seguridad (obligatorios, `docs/specs.md`)

### R11 — (RF-A1, RF-C3) Aislamiento y autorización

SI una petición autenticada en el tenant A consulta o modifica una
plantilla, zona o ítem del tenant B ENTONCES el sistema DEBE responder 404
sin revelar su existencia. SI un usuario con rol `propietario` o
`inquilino` invoca cualquier endpoint DEBE responder 403; SI un usuario
`empleado` invoca la gestión (clonar/zonas/ítems) DEBE responder 403; sin
token, 401.

### R12 — (RF-C3, `docs/architecture.md`) Sin contexto de tenant, falla

SI un repositorio de esta feature se ejecuta sin contexto de tenant
establecido ENTONCES el sistema DEBE fallar con `SinContextoDeTenantError`.

### R13 — (RF-W4, §11.3) Auditoría de las mutaciones

CUANDO se clona una plantilla o se crea/actualiza/da de baja una zona o un
ítem, el sistema DEBE registrar la entrada en `audit_log` con `tenant_id`,
`actor_id`, `accion`, `entity_type` y `entity_id`, con `metadata` vacío (no
hay PII en plantillas, pero el patrón se mantiene).

---

## Grupo E — Gobernanza del cambio

### R14 — (D2, `docs/conventions.md`, C4/C6) Migración versionada y listas al día

EL sistema DEBE aplicar los cambios de esquema en una única migración
versionada, forward-only e idempotente (previsiblemente
`0015_inventory_templates.sql`), y `TABLAS_PERMITIDAS` (+3) y
`RUTAS_PERMITIDAS` (+9) DEBEN actualizarse en el mismo cambio.

### R15 — (RF-I24, docs/specs.md) Frontera de la materialización anclada

EL sistema NO DEBE materializar la plantilla en inventarios (RF-I24): es la
feature **#12**, que copiará la plantilla vigente a las zonas/ítems del
inventario como snapshot. #11 entrega el molde y su gestión; la dependencia
queda registrada.

---

## CRITERIOS DE ACEPTACIÓN del humano (feature_list.json #11)

| Criterio | R que lo satisface |
|---|---|
| Jerarquía PropertyTypeTemplate → TemplateZone → TemplateItem | R1, R2, R3 |
| Ítems con field_type configurable: estado, si_no, si_no_estado, conteo, seleccion, texto | R3, R8, R9 |
| Zonas repetibles e instanciables N veces, y zonas obligatorias | R2, R10 |
| Plantillas base del sistema para apartamento, casa, local, oficina, bodega y parqueadero | R4 |
| El tenant puede clonar y personalizar una plantilla base sin afectar la del sistema | R5, R6, R7, R8 |

## DECISIONES que el humano confirma en la puerta del spec

| Id | Pregunta | Decisión propuesta | Motivo |
|---|---|---|---|
| **PA-11-1** | ¿Dónde viven las plantillas del sistema? | Misma tabla con `tenant_id` reservado + RLS con OR de lectura y `WITH CHECK` propio — el patrón ya validado de #7 (workflow_definicion) | Un solo régimen, la escritura de filas del sistema bloqueada por el motor |
| **PA-11-2** | ¿El catálogo base se siembra completo? | APARTAMENTO con el ejemplo completo del PRD §8.8.5; las otras cinco como plantillas **sin zonas** (el PRD no las enumera) | No se inventa producto; el tenant las clona y completa |
| **PA-11-3** | ¿La materialización? | Fuera de #11: es #12 (snapshot + libertad ad-hoc, RF-I24) | La frontera §8.8 nivel 3 es del inventario |
| **PA-11-4** | ¿Quién gestiona? | Clonar y editar: solo `admin` (RF-I22); lectura: admin/empleado | Mismo criterio que la gestión de workflows (#7) |

**No quedan preguntas de producto abiertas** (las cuatro decisiones quedan
explícitas para la puerta del spec).
