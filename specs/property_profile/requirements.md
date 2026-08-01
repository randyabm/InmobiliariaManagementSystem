# Requirements — property_profile

> Feature #6. Hoja de vida del inmueble.
> Anclaje al PRD: **RF-P1** (CRUD con grupos de datos), **RF-P2** (asociación
> propiedad ↔ propietario(s) ↔ inquilino actual), **RF-P3** (historial de
> ocupación y repositorio documental), **RF-C5** (cuenta de giro con override
> por propiedad), **RF-C6** (crear si no existe — frontera), **RF-W4** y
> §11.3 (auditoría e invariantes), **D2** (RLS), §8.7 (entidad `Property`),
> §12.1 (ingreso — frontera), §13.4 (digitalización — frontera).

Notación EARS estricta (`docs/specs.md`). Un solo `DEBE` por requirement.

## Dependencias

- **#5 `owner_tenant_profiles` (done):** `perfil_propietario`,
  `perfil_inquilino`, `cuenta_bancaria` y `resolverCuentaDeGiro` con la regla
  de precedencia **override → predeterminada → error**. El design.md de #5
  dejó escrita la dependencia que esta feature cierra: la columna
  `propiedad.cuenta_bancaria_id` y el test de integración del override a
  través de la propiedad (§6).
- **#25 (done):** la retención se resuelve por propietario
  (`sujeto_retencion`) + `tarifa_retencion` del tenant/año. #6 **no** añade
  ninguna columna de retención a la propiedad (R5 del #25 aplica al mismo
  criterio: la tarifa vive en un solo sitio).
- **#27 (done):** toda ruta protegida pasa por la validación de sesión
  existente; no se toca.

## Fronteras explícitas (qué NO es de #6)

- **Estado del ciclo de vida (RF-P4/P5):** es la feature **#8**
  `property_lifecycle` (motor de workflows). #6 no crea `estado` ni
  transiciones; la ficha queda lista para que #8 los añada.
- **Ingreso de propiedad con creación en línea (RF-PI1..PI3, RF-C6):** es la
  feature **#9** `property_intake`. #6 exige perfiles existentes: si el
  propietario principal no existe (o es de otro tenant) → 404, y la creación
  en línea se hace en #9 reutilizando los endpoints de #5.
- **Digitalización de contratos físicos (§13.4, RF-CT6/CT7):** es la feature
  **#18** `contract_digitization`. #6 construye el **repositorio documental**
  (RF-P3: subir, listar, archivar con hash) sin inventar la taxonomía de
  contratos.
- **Renovaciones e IPC (RF-CT11):** `incremento_anual_pactado` se **captura**
  aquí (RF-P1); aplicarlo es de #19.

---

## Grupo A — Esquema de datos y RLS

### R1 — (RF-P1, D2, §8.7) Tabla `propiedad`

EL sistema DEBE persistir la ficha de la propiedad en la tabla `propiedad`
con, al menos, los grupos de datos del PRD:

- **Identificación:** `direccion` text NOT NULL, `tipo` text NOT NULL CHECK
  IN (`APARTAMENTO`, `CASA`, `LOCAL`, `OFICINA`, `BODEGA`, `PARQUEADERO`),
  `area` numeric(10,2) NOT NULL, `matricula_inmobiliaria` text NULL,
  `estrato` integer NULL CHECK 1..6, `parqueaderos` integer NOT NULL DEFAULT
  0, `depositos` integer NOT NULL DEFAULT 0, `fotos` text[] NOT NULL DEFAULT
  `{}` (claves de object storage).
- **Comercial:** `canon` numeric(12,2) NOT NULL, `valor_administracion`
  numeric(12,2) NULL, `canon_incluye_administracion` boolean NOT NULL
  DEFAULT false, `incremento_anual_pactado` numeric(5,2) NULL.
- **Administración (PH):** `nombre_conjunto` text NULL,
  `contacto_admin_nombre` text NULL, `contacto_admin_telefono` text NULL,
  `contacto_admin_correo` text NULL.
- **Contable:** `propietario_principal_id` uuid NOT NULL FK →
  `perfil_propietario(id)`, `cuenta_bancaria_id` uuid NULL FK →
  `cuenta_bancaria(id)` (override de giro, dependencia #5).
- **Ocupación:** `inquilino_actual_id` uuid NULL FK → `perfil_inquilino(id)`.
- `activo` boolean NOT NULL DEFAULT true, `created_at`, `updated_at`.

con RLS habilitado, forzado y política por `tenant_id` en la misma migración
que la crea. `canon`, `valor_administracion`, `area` e
`incremento_anual_pactado` son `numeric`, nunca `float`
(`docs/conventions.md`).

### R2 — (RF-P2) Tabla `propiedad_propietario`

EL sistema DEBE persistir la asociación de propietarios adicionales de una
propiedad en la tabla `propiedad_propietario` (`id`, `tenant_id`,
`propiedad_id` FK, `perfil_propietario_id` FK, `activo` boolean NOT NULL
DEFAULT true, `created_at`, `updated_at`, UNIQUE
(`propiedad_id`, `perfil_propietario_id`)) con RLS habilitado, forzado y
política por `tenant_id` en la misma migración.

> RF-P2 habla de "propietario(s)". El **principal** es obligatorio (R1) y es
> contra quien se resuelve la cuenta de giro (R8); los adicionales se
> agregan por esta tabla. Decisión PA-6-2.

### R3 — (RF-P3) Tabla `historial_ocupacion`

EL sistema DEBE persistir la línea de tiempo de arrendatarios en la tabla
`historial_ocupacion` (`id`, `tenant_id`, `propiedad_id` FK, `perfil_inquilino_id`
FK, `desde` timestamptz NOT NULL, `hasta` timestamptz NULL, `created_at`)
con RLS habilitado, forzado y política por `tenant_id` en la misma
migración. `hasta` NULL = ocupación vigente; a lo sumo una vigente por
propiedad (índice único parcial).

### R4 — (RF-P3, §13.4 frontera) Tabla `propiedad_documento`

EL sistema DEBE persistir el repositorio documental de la propiedad en la
tabla `propiedad_documento` (`id`, `tenant_id`, `propiedad_id` FK, `nombre`
text NOT NULL, `tipo_documento` text NULL — texto libre, el PRD no define
taxonomía y no se inventa una —, `clave_storage` text NOT NULL,
`hash_sha256` text NOT NULL, `mime` text NULL, `tamano_bytes` bigint NULL,
`subido_por` uuid NULL FK → `user(id)`, `activo` boolean NOT NULL DEFAULT
true, `created_at`, `updated_at`, UNIQUE (`clave_storage`)) con RLS
habilitado, forzado y política por `tenant_id` en la misma migración. El
binario **nunca** va a la base: vive en object storage (R11).

---

## Grupo B — CRUD de la ficha (RF-P1)

### R5 — (RF-P1, RF-C3) Crear la propiedad

CUANDO un usuario con rol `admin` o `empleado` envía `POST /propiedades`
con los grupos de datos y `propietario_principal_id`, el sistema DEBE crear
la propiedad en el tenant de la petición y responder 201 con la ficha
completa. SI el propietario principal no existe o es de otro tenant
ENTONCES el sistema DEBE responder 404 sin revelar su existencia (R14).

### R6 — (RF-P1) Consultar la ficha

CUANDO un usuario autorizado invoca `GET /propiedades/:id`, el sistema DEBE
responder 200 con los grupos de datos, los propietarios (principal +
adicionales activos), la cuenta de giro **resuelta** (R8) y el
`inquilino_actual` con sus datos básicos.

### R7 — (RF-P1) Actualizar y dar de baja

CUANDO un usuario autorizado invoca `PATCH /propiedades/:id` o
`DELETE /propiedades/:id`, el sistema DEBE aplicar los campos enviados
(validando el override de cuenta si cambia, R8) o marcar `activo = false`
respectivamente, y NO DEBE ejecutar un borrado físico.

### R8 — (RF-C5, dependencia #5) El override de cuenta de giro

CUANDO `POST` o `PATCH /propiedades` recibe `cuenta_bancaria_id`, el sistema
DEBE validar que esa cuenta pertenece al **propietario principal** y al
mismo tenant usando la regla de #5 (`resolverCuentaDeGiro`); SI el override
es ajeno ENTONCES el sistema DEBE responder 400 `CUENTA_DE_GIRO_INVALIDA` y
NO DEBE persistir. La ficha DEBE exponer la cuenta de giro resuelta con la
precedencia **override → predeterminada del principal → `null`** (sin error:
la ficha puede no tener cuenta todavía; el error de giro queda para el
momento de calcular dinero).

### R9 — (RF-P1) Precisión numérica

EL sistema DEBE transportar y devolver `canon`, `valor_administracion`,
`area` e `incremento_anual_pactado` como cadenas decimales exactas, sin
convertirlos a `number` de JavaScript en ninguna frontera (mismo criterio
que #25 R11).

---

## Grupo C — Propietarios e inquilino actual (RF-P2)

### R10 — (RF-P2) Añadir y remover propietarios adicionales

CUANDO un usuario autorizado invoca `POST /propiedades/:id/propietarios` o
`DELETE /propiedades/:idPropiedad/propietarios/:idPropietario`, el sistema
DEBE asociar (404 si el perfil no existe o es de otro tenant, R14) o dar de
baja lógica (`activo = false`) la asociación. SI la baja apunta al
propietario **principal** ENTONCES el sistema DEBE responder 409
`PROPIETARIO_PRINCIPAL_NO_REMOVIBLE` sin modificar nada.

### R11 — (RF-P2, RF-P3) Asignar el inquilino actual

CUANDO un usuario autorizado envía `PATCH /propiedades/:id/inquilino-actual`
con `{ perfil_inquilino_id | null }`, el sistema DEBE, en una sola
transacción, actualizar `inquilino_actual_id` y cerrar la ocupación vigente
(`hasta = now()`) y abrir la nueva (`desde = now()`) en
`historial_ocupacion` (o dejar la línea vigente cuando `null`). 404 si el
perfil no existe o es de otro tenant (R14).

### R12 — (RF-P3) Historial de ocupación consultable

CUANDO un usuario autorizado invoca `GET /propiedades/:id/historial-ocupacion`,
el sistema DEBE responder 200 con la línea de tiempo ordenada por `desde`
descendente, incluyendo los datos básicos del inquilino de cada período.

---

## Grupo D — Repositorio documental y fotos (RF-P3)

### R13 — (RF-P3, §7 NFR) Subir un documento

CUANDO un usuario autorizado envía `POST /propiedades/:id/documentos`
(multipart: archivo + `nombre` + opcional `tipo_documento`), el sistema DEBE
almacenar el binario en object storage, calcular su `hash_sha256` (SHA-256
del binario), crear la fila en `propiedad_documento` y responder 201 con la
fila. El binario NO DEBE quedar en la base ni en logs (R15).

### R14 — (RF-A1, RF-C3) Aislamiento y existencia

SI una petición autenticada en el tenant A solicita, modifica o da de baja
cualquier fila de `propiedad`, `propiedad_propietario`,
`historial_ocupacion` o `propiedad_documento` del tenant B ENTONCES el
sistema DEBE responder 404 sin revelar su existencia. El 404 de "no existe"
y el de "es de otro tenant" DEBEN ser indistinguibles.

### R15 — (§11.3, Ley 1581 de 2012) Datos personales y binarios fuera de logs y auditoría

EL sistema NO DEBE incluir `direccion`, `matricula_inmobiliaria`,
`telefono`/`correo` de contacto de la administración, binarios, ni claves de
storage en los logs de aplicación ni en el campo `metadata` de `audit_log`.

### R16 — (RF-P3) Listar y archivar documentos

CUANDO un usuario autorizado invoca `GET /propiedades/:id/documentos` o
`DELETE /propiedades/:idPropiedad/documentos/:idDocumento`, el sistema DEBE
listar los documentos activos o marcarlos `activo = false` (baja lógica,
sin borrar el objeto), respectivamente.

### R17 — (RF-P1) Fotos de la propiedad

CUANDO un usuario autorizado invoca `POST /propiedades/:id/fotos`
(multipart) o `DELETE /propiedades/:id/fotos` con `{ clave }`, el sistema
DEBE almacenar el binario en object storage, añadir la clave a `fotos` o
quitarla de ella, y responder 201/200. Las claves de `fotos` DEBEN
pertenecer a la propiedad (el DELETE de una clave ajena responde 400).

---

## Grupo E — Invariantes de seguridad (obligatorios, `docs/specs.md`)

### R18 — (RF-C3) Autorización por rol en el backend

SI un usuario cuyo único rol activo en el tenant es `propietario` o
`inquilino` invoca cualquier endpoint de `/propiedades*` ENTONCES el sistema
DEBE rechazar la petición en el backend con 403.

### R19 — (RF-C3, `docs/architecture.md`) Sin contexto de tenant, falla

SI un repositorio de esta feature se ejecuta sin contexto de tenant
establecido ENTONCES el sistema DEBE fallar con `SinContextoDeTenantError` y
NO DEBE consultar la base con una conexión del pool sin `SET LOCAL`.

### R20 — (RF-W4, §11.3) Auditoría de acciones críticas

CUANDO se crea, actualiza o da de baja una propiedad, se añade o remueve un
propietario, se cambia el inquilino actual o se sube un documento, el
sistema DEBE registrar una entrada en `audit_log` con `tenant_id`,
`actor_id`, `accion`, `entity_type` y `entity_id` del recurso afectado.

### R21 — (RF-P3, §7 NFR) Integridad documental

CUANDO un documento se almacena, el sistema DEBE verificar que el
`hash_sha256` recalculado del binario recibido coincide con el del
almacenamiento (el objeto devuelto por object storage al subirlo), y la
ficha DEBE exponer ese hash. Un test DEBE verificar el hash del binario
almacenado contra la fila de `propiedad_documento`.

---

## Grupo F — Gobernanza del cambio

### R22 — (D2, `docs/conventions.md`, C4/C6) Migración versionada y verificada

EL sistema DEBE aplicar todos los cambios de esquema de esta feature en una
única migración versionada, forward-only e idempotente (la siguiente libre
en `apps/api/drizzle/`, previsiblemente `0012_property_profile.sql`), y las
listas de control existentes (`TABLAS_PERMITIDAS` en `tests/migrations.test.ts`
y `RUTAS_PERMITIDAS` en `routes-surface.test.ts`) DEBEN actualizarse con las
cuatro tablas y las 14 rutas nuevas en el mismo cambio.

---

## CRITERIOS DE ACEPTACIÓN del humano (feature_list.json #6)

| Criterio | R que lo satisface |
|---|---|
| CRUD de propiedad con los grupos de datos del PRD | R1, R5, R6, R7, R9 |
| Asociación propiedad ↔ propietario(s) ↔ inquilino actual | R1, R2, R10, R11 |
| Historial de ocupación consultable | R3, R11, R12 |
| Repositorio documental por propiedad | R4, R13, R16, R21 |

## DECISIONES DEL HUMANO que originan decisiones en esta feature

| Id | Pregunta | Decisión propuesta | Motivo |
|---|---|---|---|
| **PA-6-1** | Fotos y documentos: ¿subida real a object storage ahora? | **Sí, dentro de #6**: módulo compartido de almacenamiento (MinIO) usado por fotos y repositorio documental | El criterio de aceptación exige el repositorio documental; el PRD (§7 NFR, §8.7) y `docker-compose` ya tienen MinIO; las features #12 y #18 lo reutilizarán |
| **PA-6-2** | RF-P2 "propietario(s)": ¿cómo se modela? | **Principal obligatorio** (contra quien se resuelve la cuenta de giro, integración directa con #5) + **adicionales** por tabla puente | El PRD §8.7 define `propietario_id` singular y la regla de giro de #5 resuelve contra un perfil; la puente cubre el plural sin ambigüedad de giro |
| **PA-6-3** | Estado del ciclo de vida y creación en línea (RF-C6) | **Fuera de #6**: son #8 (lifecycle/dashboard) y #9 (intake) | La ficha no inventa el motor de workflows ni los escenarios de ingreso |

**No quedan preguntas de producto abiertas** (las tres decisiones quedan
explícitas para la puerta del spec).
