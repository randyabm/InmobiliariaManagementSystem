# Requirements — retencion_codeudor_referencias

> Feature #25. Tarifa de retención en la fuente por tenant, y codeudores /
> coarrendatarios / referencias del inquilino.
> Anclaje al PRD: **RF-C4** (datos del inquilino: "opcionalmente
> codeudor/coarrendatario … y referencias"), **RF-C5** (hoja de vida del
> propietario: "datos fiscales (retención/certificados)"). Referencias de
> apoyo: RF-P1 (grupo contable de la propiedad), RF-C3/RF-A1 (RBAC +
> aislamiento), RF-W4 y §11.3 (auditoría e invariantes), D2 (RLS), Ley 1581 de
> 2012.
>
> **Origen:** esta feature se separó de la #5 `owner_tenant_profiles` por
> decisión del humano (un solo diff de 55 tasks era inrevisable). Implementa las
> decisiones **D-2** (tarifa por tenant) y **D-6** (codeudor y referencias como
> captura de datos).

Notación EARS estricta (`docs/specs.md`). Un solo `DEBE` por requirement.

## Dependencia dura de la feature #5

Esta feature **no puede implementarse antes de que la #5 esté `done`**. Da por
hechos, sin volver a especificarlos:

- Las tablas `perfil_propietario` (con su columna `sujeto_retencion`) y
  `perfil_inquilino` con RLS activo y forzado.
- El helper `obtenerClienteTenant(request)` y el error
  `SinContextoDeTenantError`.
- `TenantContextInterceptor` registrado como `APP_INTERCEPTOR`, con el tenant
  resuelto del header `x-tenant-id` validado contra los roles activos del JWT.
- El módulo `apps/api/src/modules/core/clientes/`, que esta feature **extiende**.
- `ResourceNotFoundError` (404 para recursos inexistentes o de otro tenant).

---

## Grupo A — Esquema de datos y RLS

### R1 — (RF-C5, RF-P1, D-2, D2) Tabla `tarifa_retencion`

EL sistema DEBE persistir la tarifa de retención en la fuente como
configuración **del tenant y por año** en la tabla `tarifa_retencion` con, al
menos, los campos:

- `id` uuid PK DEFAULT `gen_random_uuid()`
- `tenant_id` uuid NOT NULL FK → `tenant(id)`
- `anio` integer NOT NULL
- `porcentaje` numeric(5,2) NOT NULL
- `created_at` timestamptz NOT NULL DEFAULT now()
- `updated_at` timestamptz NOT NULL DEFAULT now()
- UNIQUE (`tenant_id`, `anio`)

`porcentaje` es `numeric`, nunca `float` (`docs/conventions.md`).

### R2 — (RF-C4, D-6, D2) Tabla `codeudor_inquilino`

EL sistema DEBE persistir los codeudores y coarrendatarios del inquilino en la
tabla `codeudor_inquilino` con, al menos, los campos:

- `id` uuid PK DEFAULT `gen_random_uuid()`
- `tenant_id` uuid NOT NULL FK → `tenant(id)`
- `perfil_inquilino_id` uuid NOT NULL FK → `perfil_inquilino(id)`
- `tipo` text NOT NULL CHECK IN (`CODEUDOR`, `COARRENDATARIO`)
- `nombre` text NOT NULL
- `tipo_documento` text NOT NULL CHECK IN (`CC`, `CE`, `NIT`, `PASAPORTE`)
- `documento` text NOT NULL
- `email` text NULL
- `celular` text NULL
- `activo` boolean NOT NULL DEFAULT true
- `created_at` timestamptz NOT NULL DEFAULT now()
- `updated_at` timestamptz NOT NULL DEFAULT now()
- UNIQUE (`tenant_id`, `perfil_inquilino_id`, `tipo_documento`, `documento`)

La unicidad del documento es **dentro del tenant** (criterio **D-7** heredado
de la #5: una unicidad global permitiría descubrir por colisión que una persona
ya figura en otra inmobiliaria, §11.3).

### R3 — (RF-C4, D-6, D2) Tabla `referencia_inquilino`

EL sistema DEBE persistir las referencias del inquilino en la tabla
`referencia_inquilino` con, al menos, los campos:

- `id` uuid PK DEFAULT `gen_random_uuid()`
- `tenant_id` uuid NOT NULL FK → `tenant(id)`
- `perfil_inquilino_id` uuid NOT NULL FK → `perfil_inquilino(id)`
- `nombre` text NOT NULL
- `telefono` text NOT NULL
- `relacion` text NULL — texto libre: el PRD no define una taxonomía de
  referencias y no se inventa una
- `email` text NULL
- `activo` boolean NOT NULL DEFAULT true
- `created_at` timestamptz NOT NULL DEFAULT now()
- `updated_at` timestamptz NOT NULL DEFAULT now()

### R4 — (D2, RF-A1, §11.3) RLS en las tres tablas nuevas

CUANDO la migración crea `tarifa_retencion`, `codeudor_inquilino` y
`referencia_inquilino`, el sistema DEBE ejecutar en esa misma migración
`ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY` y una política que
filtre por `tenant_id = current_setting('app.current_tenant', true)::uuid`
para las tres tablas.

### R5 — (RF-C5, D-2) La tarifa no se duplica en el perfil

EL sistema NO DEBE añadir a `perfil_propietario` ninguna columna de tarifa o
porcentaje de retención: la tarifa vive únicamente en `tarifa_retencion`.

---

## Grupo B — Tarifa de retención por tenant y año (RF-C5, D-2)

### R6 — (RF-C5, D-2) Configurar la tarifa

CUANDO un usuario con rol `admin` envía `PUT /configuracion/retencion/:anio`
con `porcentaje`, el sistema DEBE registrar o reemplazar la tarifa de retención
de **ese tenant** para ese año y responder 200 con la tarifa resultante.

### R7 — (RF-C5, D-2) Consultar las tarifas del tenant

CUANDO un usuario con rol `admin` invoca `GET /configuracion/retencion`, el
sistema DEBE responder 200 con las tarifas del tenant de la petición ordenadas
por `anio` descendente.

### R8 — (RF-C5, D-2) Resolución de la tarifa aplicable

CUANDO se invoca `RetencionService.resolverPorcentaje(anio, ctx)` para un
propietario con `sujeto_retencion = true`, el sistema DEBE devolver el
`porcentaje` de `tarifa_retencion` del tenant y del año indicados.

### R9 — (RF-C5, D-2) Año sin tarifa configurada

SI se invoca `resolverPorcentaje` para un año que el tenant no ha configurado
ENTONCES el sistema DEBE lanzar `TarifaRetencionNoConfiguradaError` y NO DEBE
asumir un porcentaje por defecto.

### R10 — (RF-C5, D-2) Propietario no sujeto a retención

CUANDO se resuelve la retención aplicable a un propietario con
`sujeto_retencion = false`, el sistema DEBE indicar que no aplica retención sin
consultar `tarifa_retencion`.

### R11 — (RF-C5, D-2) Precisión del porcentaje

EL sistema DEBE transportar y devolver `porcentaje` como cadena decimal exacta
(sin convertirlo a `number` de JavaScript en ninguna frontera).

---

## Grupo C — Codeudores, coarrendatarios y referencias (RF-C4, D-6)

### R12 — (RF-C4, D-6) Registrar un codeudor o coarrendatario

CUANDO un usuario con rol `admin` o `empleado` envía
`POST /inquilinos/:id/codeudores` con `tipo`, `nombre`, `tipo_documento` y
`documento` —y opcionalmente `email` y `celular`— el sistema DEBE crear el
codeudor asociado a ese inquilino en el tenant de la petición y responder 201
con su `id`.

### R13 — (RF-C4, D-6) Listar, actualizar y dar de baja codeudores

CUANDO un usuario autorizado invoca `GET`, `PATCH` o `DELETE` sobre
`/inquilinos/:id/codeudores`, el sistema DEBE listar los codeudores activos,
aplicar los campos enviados o marcar `activo = false` respectivamente, y NO
DEBE ejecutar un borrado físico.

### R14 — (RF-C4, D-6) Codeudor duplicado en el mismo inquilino

SI `POST /inquilinos/:id/codeudores` envía un (`tipo_documento`, `documento`)
que ya está registrado para ese inquilino ENTONCES el sistema DEBE responder
409 con el código `CODEUDOR_YA_EXISTE` y NO DEBE crear una fila duplicada.

### R15 — (RF-C4, D-6) Registrar una referencia

CUANDO un usuario con rol `admin` o `empleado` envía
`POST /inquilinos/:id/referencias` con `nombre` y `telefono` —y opcionalmente
`relacion` y `email`— el sistema DEBE crear la referencia asociada a ese
inquilino en el tenant de la petición y responder 201 con su `id`.

### R16 — (RF-C4, D-6) Listar, actualizar y dar de baja referencias

CUANDO un usuario autorizado invoca `GET`, `PATCH` o `DELETE` sobre
`/inquilinos/:id/referencias`, el sistema DEBE listar las referencias activas,
aplicar los campos enviados o marcar `activo = false` respectivamente, y NO
DEBE ejecutar un borrado físico.

### R17 — (RF-C4, D-6) Frontera con la firma del contrato (comportamiento)

EL sistema NO DEBE exigir la existencia de un contrato, de un proceso de firma
ni de ninguna entidad de las features #14/#17 para registrar un codeudor o una
referencia.

### R18 — (RF-C4, D-6) Frontera con la firma del contrato (estructura)

EL sistema NO DEBE declarar en `codeudor_inquilino` ni en
`referencia_inquilino` ninguna clave foránea hacia entidades de contrato,
firma, inventario u OTP.

> RF-C4 describe al codeudor como "ligado a la firma". En esta feature es
> **captura de datos**; el amarre codeudor ↔ firmante lo añaden #14/#17,
> declarando la FK **desde** la tabla de firmas, no al revés. Ver `design.md`
> §5.

---

## Grupo D — Invariantes de seguridad (obligatorios, `docs/specs.md`)

### R19 — (RF-A1, RF-C3) Aislamiento por tenant

SI una petición autenticada en el tenant A solicita, modifica o da de baja
cualquier fila de `tarifa_retencion`, `codeudor_inquilino` o
`referencia_inquilino` del tenant B ENTONCES el sistema DEBE responder 404 sin
revelar su existencia.

### R20 — (RF-C3, §11.3) Autorización por rol en el backend

SI un usuario cuyo único rol activo en el tenant es `propietario` o `inquilino`
invoca cualquier endpoint de `/inquilinos/:id/codeudores`,
`/inquilinos/:id/referencias` o `/configuracion/retencion` ENTONCES el sistema
DEBE rechazar la petición en el backend con 403.

### R21 — (RF-C3, §11.3) La configuración de retención es solo de `admin`

SI un usuario con rol `empleado` invoca `GET /configuracion/retencion` o
`PUT /configuracion/retencion/:anio` ENTONCES el sistema DEBE rechazar la
petición en el backend con 403.

### R22 — (D2, RF-C3, `docs/architecture.md`) Sin contexto de tenant, falla

SI un repositorio de esta feature se ejecuta sin contexto de tenant establecido
(`app.current_tenant` no fijado en la conexión) ENTONCES el sistema DEBE fallar
con `SinContextoDeTenantError` y NO DEBE consultar la base de datos con una
conexión del pool sin `SET LOCAL`.

### R23 — (RF-W4, §11.3) Auditoría de acciones críticas

CUANDO se crea, actualiza o da de baja una `tarifa_retencion`, un
`codeudor_inquilino` o una `referencia_inquilino`, el sistema DEBE registrar
una entrada en `audit_log` con `tenant_id`, `actor_id`, `accion`, `entity_type`
y `entity_id` del recurso afectado.

### R24 — (§11.3, Ley 1581 de 2012) Datos personales fuera de logs y auditoría

EL sistema NO DEBE incluir `documento`, `celular`, `telefono` ni `email` de
codeudores y referencias en los logs de aplicación ni en el campo `metadata` de
`audit_log`.

---

## Grupo E — Gobernanza del cambio

### R25 — (D2, `docs/conventions.md`, C4/C6) Migración versionada y verificada

EL sistema DEBE aplicar todos los cambios de esquema de esta feature en una
única migración versionada, forward-only e idempotente (la siguiente libre en
`apps/api/drizzle/`, previsiblemente `0006_retencion_codeudor_referencias.sql`),
y las listas de control existentes (`TABLAS_PERMITIDAS` en
`tests/migrations.test.ts` y `RUTAS_PERMITIDAS` en `routes-surface.test.ts`)
DEBEN actualizarse con las tres tablas y las 10 rutas nuevas en el mismo cambio.

---

## DECISIONES DEL HUMANO que originan esta feature

Se conservan íntegras con su motivo, tal como se acordaron sobre el spec
unificado de la #5.

| Id | Pregunta | Decisión | Motivo dado | Efecto en esta feature |
|---|---|---|---|---|
| **D-2** | ¿La retención se modela por propietario o por tenant? | **Por tenant.** `sujeto_retencion` (boolean) se queda en `perfil_propietario` (#5); la **tarifa** no va por propietario. | La tarifa la fija la ley y cambia por año; una copia por propietario se desincroniza en silencio y produce cálculos de giro incorrectos. | R1, R5–R11: tabla `tarifa_retencion (tenant_id, anio)`, endpoints solo-`admin` y resolución explícita con error si el año no está configurado. |
| **D-6** | Codeudor/coarrendatario y referencias del inquilino (RF-C4 los lista como opcionales) | **Entran en el producto, solo como captura de datos.** El amarre a la firma del contrato queda en #14/#17. | RF-C4 los enumera como parte de los datos del inquilino; el valor legal de la firma es otro alcance. | R2, R3, R12–R18, con la frontera probada en dos niveles (comportamiento y estructura). |
| **D-7** | Ubicación del documento de identidad (heredada de #5) | Vive en la tabla de negocio con unicidad **dentro** del tenant, no global. | Una unicidad global permitiría descubrir por colisión que una persona ya figura en otro tenant (§11.3). | R2 aplica el mismo criterio a `codeudor_inquilino`. |

### Contradicciones y pendientes registrados

- **La tarifa hereda el pendiente técnico del PRD §13.5** (fuente del IPC:
  carga manual anual por el admin vs. integración con el DANE). Aquí se resuelve
  igual que el PRD recomienda para el IPC: **carga manual por el `admin`**
  (R6), sin valor por defecto (R9). Si más adelante se integra una fuente
  externa, `tarifa_retencion` es el punto donde enchufarla.
- **El cálculo monetario del giro no es de esta feature.** #25 resuelve
  *cuánto por ciento aplica*; aplicar ese porcentaje a un canon concreto
  pertenece al módulo de pagos/contable (PRD §15). Ver `design.md` §6.
- **Certificados de retención (D-3):** siguen diferidos al módulo contable;
  esta feature no los genera ni los almacena.

**No quedan preguntas abiertas.**
