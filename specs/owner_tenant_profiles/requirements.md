# Requirements — owner_tenant_profiles

> Feature #5. Hoja de vida de propietario e inquilino.
> Anclaje al PRD: **RF-C1** (registro de clientes), **RF-C4** (datos del
> inquilino), **RF-C5** (hoja de vida del propietario), **RF-C6** (crear si no
> existe). Referencias de apoyo: RF-C2/RF-AU6 (identidad multi-rol),
> RF-C3/RF-A1 (RBAC + aislamiento), RF-P1 (grupo contable de la propiedad),
> RF-W4 y §11.3 (auditoría e invariantes), D2 (RLS), Ley 1581 de 2012.

Notación EARS estricta (`docs/specs.md`). Un solo `DEBE` por requirement.

---

## Grupo A — Esquema de datos y RLS

### R1 — (RF-C5, RF-C1, D2) Tabla `perfil_propietario`

EL sistema DEBE persistir la hoja de vida del propietario en la tabla
`perfil_propietario` con, al menos, los campos:

- `id` uuid PK DEFAULT `gen_random_uuid()`
- `tenant_id` uuid NOT NULL FK → `tenant(id)`
- `user_id` uuid NOT NULL FK → `user(id)` — identidad de la persona
- `tipo_documento` text NOT NULL CHECK IN (`CC`, `CE`, `NIT`, `PASAPORTE`)
- `documento` text NOT NULL
- `direccion_notificacion` text NULL
- `ciudad` text NULL
- `sujeto_retencion` boolean NOT NULL DEFAULT false
- `porcentaje_retencion` numeric(5,2) NULL
- `activo` boolean NOT NULL DEFAULT true
- `created_at` timestamptz NOT NULL DEFAULT now()
- `updated_at` timestamptz NOT NULL DEFAULT now()
- UNIQUE (`tenant_id`, `user_id`)
- UNIQUE (`tenant_id`, `tipo_documento`, `documento`)

Los datos de contacto de la persona (`nombre`, `email`, `telefono`) NO se
duplican: viven en `user` (feature #3).

### R2 — (RF-C4, RF-C1, D2) Tabla `perfil_inquilino`

EL sistema DEBE persistir la hoja de vida del inquilino en la tabla
`perfil_inquilino` con, al menos, los campos:

- `id` uuid PK DEFAULT `gen_random_uuid()`
- `tenant_id` uuid NOT NULL FK → `tenant(id)`
- `user_id` uuid NOT NULL FK → `user(id)`
- `tipo_documento` text NOT NULL CHECK IN (`CC`, `CE`, `NIT`, `PASAPORTE`)
- `documento` text NOT NULL
- `celular` text NOT NULL
- `medio_preferido_contacto` text NOT NULL CHECK IN (`CORREO`, `SMS`,
  `WHATSAPP`, `LLAMADA`)
- `activo` boolean NOT NULL DEFAULT true
- `created_at` timestamptz NOT NULL DEFAULT now()
- `updated_at` timestamptz NOT NULL DEFAULT now()
- UNIQUE (`tenant_id`, `user_id`)
- UNIQUE (`tenant_id`, `tipo_documento`, `documento`)

### R3 — (RF-C5, RF-P1, D2) Tabla `cuenta_bancaria`

EL sistema DEBE persistir las cuentas de giro del canon en la tabla
`cuenta_bancaria` con, al menos, los campos:

- `id` uuid PK DEFAULT `gen_random_uuid()`
- `tenant_id` uuid NOT NULL FK → `tenant(id)`
- `perfil_propietario_id` uuid NOT NULL FK → `perfil_propietario(id)`
- `banco` text NOT NULL
- `tipo_cuenta` text NOT NULL CHECK IN (`AHORROS`, `CORRIENTE`)
- `numero_cuenta` text NOT NULL
- `titular_nombre` text NOT NULL
- `titular_tipo_documento` text NOT NULL CHECK IN (`CC`, `CE`, `NIT`,
  `PASAPORTE`)
- `titular_documento` text NOT NULL
- `es_predeterminada` boolean NOT NULL DEFAULT false
- `activa` boolean NOT NULL DEFAULT true
- `created_at` timestamptz NOT NULL DEFAULT now()
- `updated_at` timestamptz NOT NULL DEFAULT now()

### R4 — (RF-C5) Una sola cuenta predeterminada por propietario

SI se intenta dejar más de una `cuenta_bancaria` activa con
`es_predeterminada = true` para el mismo `perfil_propietario_id` ENTONCES la
base de datos DEBE rechazar la escritura mediante un índice único parcial
sobre (`perfil_propietario_id`) WHERE `es_predeterminada` AND `activa`.

### R5 — (D2, RF-A1, §11.3) RLS en las tres tablas nuevas

CUANDO la migración crea `perfil_propietario`, `perfil_inquilino` y
`cuenta_bancaria`, el sistema DEBE ejecutar en esa misma migración
`ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY` y una política que
filtre por `tenant_id = current_setting('app.current_tenant', true)::uuid`
para las tres tablas.

### R6 — (RF-AU1, RF-C1) Identidad sin credenciales

MIENTRAS un registro de `user` tenga `password_hash` NULL (cliente registrado
como propietario o inquilino que aún no activó portal), el endpoint
`POST /auth/login` DEBE responder 401 para ese email sin evaluar ninguna
contraseña.

> La migración de esta feature relaja `user.password_hash` a NULL-able porque
> un cliente (RF-C1) se registra sin credenciales. R6 cierra el riesgo de
> login sin contraseña que esa relajación abre.

---

## Grupo B — CRUD de propietario (RF-C5)

### R7 — (RF-C5, RF-C1) Crear propietario

CUANDO un usuario con rol `admin` o `empleado` envía
`POST /propietarios` con `nombre`, `email`, `tipo_documento`, `documento` y,
opcionalmente, `telefono`, `direccion_notificacion`, `ciudad`,
`sujeto_retencion` y `porcentaje_retencion`, el sistema DEBE crear el perfil
del propietario en el tenant de la petición y responder 201 con su `id`.

### R8 — (RF-C5) Registrar cuenta bancaria del propietario

CUANDO un usuario autorizado envía
`POST /propietarios/:id/cuentas-bancarias` con `banco`, `tipo_cuenta`,
`numero_cuenta`, `titular_nombre`, `titular_tipo_documento` y
`titular_documento`, el sistema DEBE crear la cuenta asociada a ese
propietario y marcarla `es_predeterminada = true` si el propietario no tenía
ninguna cuenta predeterminada activa.

### R9 — (RF-C5) Consultar la hoja de vida del propietario

CUANDO un usuario autorizado invoca `GET /propietarios/:id`, el sistema DEBE
responder 200 con los datos personales, los datos fiscales, la lista de
cuentas bancarias activas del propietario y la identificación de cuál es la
predeterminada.

### R10 — (RF-C5) Actualizar propietario

CUANDO un usuario autorizado envía `PATCH /propietarios/:id` con un
subconjunto de campos editables, el sistema DEBE aplicar solo esos campos y
actualizar `updated_at`.

### R11 — (RF-C5, `docs/conventions.md`) Baja lógica del propietario

CUANDO un usuario autorizado invoca `DELETE /propietarios/:id`, el sistema
DEBE marcar `activo = false` y NO DEBE ejecutar un borrado físico de la fila.

### R12 — (RF-C5) Cambiar la cuenta predeterminada

CUANDO un usuario autorizado invoca
`PATCH /propietarios/:idPropietario/cuentas-bancarias/:idCuenta` con
`es_predeterminada = true`, el sistema DEBE, en una sola transacción, quitar
la marca a la cuenta predeterminada anterior y ponerla en la indicada.

---

## Grupo C — CRUD de inquilino (RF-C4)

### R13 — (RF-C4, RF-C1) Crear inquilino con los campos mínimos

CUANDO un usuario con rol `admin` o `empleado` envía `POST /inquilinos` con
`nombre`, `tipo_documento`, `documento`, `email`, `celular` y
`medio_preferido_contacto`, el sistema DEBE crear el perfil del inquilino en
el tenant de la petición y responder 201 con su `id`.

### R14 — (RF-C4) Campos mínimos obligatorios

SI `POST /inquilinos` omite cualquiera de `nombre`, `tipo_documento`,
`documento`, `email`, `celular` o `medio_preferido_contacto`, o envía un
`medio_preferido_contacto` fuera de {`CORREO`, `SMS`, `WHATSAPP`, `LLAMADA`},
ENTONCES el sistema DEBE responder 400 sin persistir ninguna fila.

### R15 — (RF-C4) Actualizar inquilino

CUANDO un usuario autorizado envía `PATCH /inquilinos/:id` con un
subconjunto de campos editables (incluido `medio_preferido_contacto`), el
sistema DEBE aplicar solo esos campos y actualizar `updated_at`.

### R16 — (RF-C4, `docs/conventions.md`) Baja lógica del inquilino

CUANDO un usuario autorizado invoca `DELETE /inquilinos/:id`, el sistema DEBE
marcar `activo = false` y NO DEBE ejecutar un borrado físico de la fila.

---

## Grupo D — Crear en línea sin abandonar el flujo (RF-C6, RF-PI2)

### R17 — (RF-C6, RF-PI2) Creación atómica en una sola llamada

CUANDO se crea un propietario o un inquilino, el sistema DEBE escribir la
identidad (`user`), el rol del tenant (`user_role`) y el perfil
(`perfil_propietario` / `perfil_inquilino`) dentro de **una sola
transacción**, de modo que un fallo parcial no deje ninguna de las tres filas
persistida.

### R18 — (RF-C6) Búsqueda previa por documento

CUANDO un usuario autorizado invoca
`GET /propietarios?tipo_documento=<t>&documento=<d>` o
`GET /inquilinos?tipo_documento=<t>&documento=<d>`, el sistema DEBE responder
200 con el perfil coincidente **del tenant de la petición** o con una lista
vacía si no existe en ese tenant.

### R19 — (RF-C6) Documento ya registrado en el tenant

SI `POST /propietarios` o `POST /inquilinos` envía un
(`tipo_documento`, `documento`) que ya tiene perfil en el tenant de la
petición ENTONCES el sistema DEBE responder 409 con el código
`PERFIL_YA_EXISTE` y NO DEBE crear un perfil duplicado.

### R20 — (RF-C2, RF-AU6, RF-C6) Reutilización de identidad sin fuga

CUANDO el `email` recibido ya corresponde a un `user` existente, el sistema
DEBE reutilizar ese `user_id` creando únicamente el `user_role` y el perfil
del tenant de la petición, y la respuesta NO DEBE incluir ningún dato
proveniente de perfiles de ese `user` en otros tenants.

---

## Grupo E — Cuenta de giro del canon y punto de extensión hacia #6

> La entidad `Propiedad` es la feature #6 y **no existe todavía**. Esta
> feature entrega la cuenta por defecto a nivel de propietario y la **regla de
> resolución** con su punto de extensión (parámetro de override), probada de
> forma determinista. La columna `propiedad.cuenta_bancaria_id` que suministra
> el override la crea la feature #6. Ver `design.md` §6.

### R21 — (RF-C5, RF-P1) El override gana sobre la cuenta por defecto

CUANDO se invoca `CuentasBancariasService.resolverCuentaDeGiro(perfilPropietarioId, cuentaOverrideId)`
con un `cuentaOverrideId` presente y válido, el sistema DEBE resolver esa
cuenta y NO la cuenta predeterminada del propietario.

### R22 — (RF-C5, RF-P1) Sin override se usa la cuenta por defecto

CUANDO se invoca `resolverCuentaDeGiro` sin `cuentaOverrideId`, el sistema
DEBE resolver la cuenta activa del propietario con
`es_predeterminada = true`.

### R23 — (RF-C5, RF-A1) Override ajeno rechazado

SI el `cuentaOverrideId` recibido no pertenece al mismo
`perfil_propietario_id` y al mismo `tenant_id` de la petición ENTONCES el
sistema DEBE lanzar `CuentaDeGiroInvalidaError` y NO DEBE resolver esa
cuenta.

### R24 — (RF-C5) Ausencia de cuenta resoluble

SI el propietario no tiene cuenta predeterminada activa y no se recibe
override ENTONCES el sistema DEBE lanzar `CuentaDeGiroInvalidaError` y NO
DEBE devolver `null` ni una cuenta arbitraria.

---

## Grupo F — Invariantes de seguridad (obligatorios, `docs/specs.md` §req. de seguridad)

### R25 — (RF-A1, RF-C3) Aislamiento por tenant

SI una petición autenticada en el tenant A solicita, modifica o da de baja un
`perfil_propietario`, un `perfil_inquilino` o una `cuenta_bancaria` del
tenant B ENTONCES el sistema DEBE responder 404 sin revelar su existencia.

### R26 — (RF-C3, §11.3) Autorización por rol en el backend

SI un usuario cuyo único rol activo en el tenant es `propietario` o
`inquilino` invoca cualquier endpoint de `/propietarios` o `/inquilinos`
ENTONCES el sistema DEBE rechazar la petición en el backend con 403.

### R27 — (RF-AU6, RF-C3) Resolución del tenant de la petición

SI el header `x-tenant-id` de una petición autenticada no corresponde a
ningún rol activo del JWT ENTONCES el sistema DEBE responder 403 y NO DEBE
ejecutar ninguna consulta de negocio.

### R28 — (D2, RF-C3, `docs/architecture.md`) Sin contexto de tenant, falla

SI un repositorio de esta feature se ejecuta sin contexto de tenant
establecido (`app.current_tenant` no fijado en la conexión) ENTONCES el
sistema DEBE fallar con `SinContextoDeTenantError` y NO DEBE consultar la
base de datos con una conexión del pool sin `SET LOCAL`.

### R29 — (RF-W4, §11.3) Auditoría de acciones críticas

CUANDO se crea, actualiza o da de baja un `perfil_propietario`, un
`perfil_inquilino` o una `cuenta_bancaria`, el sistema DEBE registrar una
entrada en `audit_log` con `tenant_id`, `actor_id`, `accion`, `entity_type` y
`entity_id` del recurso afectado.

### R30 — (§11.3, Ley 1581 de 2012) Datos personales fuera de logs y auditoría

EL sistema NO DEBE incluir `documento`, `titular_documento`, `celular`,
`email` ni `numero_cuenta` en los logs de aplicación ni en el campo
`metadata` de `audit_log`.

---

## Grupo G — Gobernanza del cambio

### R31 — (D2, `docs/conventions.md`, C4/C6) Migración versionada y verificada

EL sistema DEBE crear las tres tablas en una única migración versionada,
forward-only e idempotente (`0005_owner_tenant_profiles.sql`), y las listas
de control existentes (`TABLAS_PERMITIDAS` en `tests/migrations.test.ts` y
`RUTAS_PERMITIDAS` en `routes-surface.test.ts`) DEBEN actualizarse con las
tablas y rutas nuevas en el mismo cambio.

---

## PREGUNTAS ABIERTAS (requieren decisión humana antes de implementar)

Ninguna de estas se ha resuelto por cuenta propia. Donde había que elegir para
poder redactar, se marca la **suposición provisional** y qué cambia si el
humano decide lo contrario.

- **PA-1 — Lista de propiedades del propietario.** RF-C5 exige que la ficha
  incluya "lista de sus propiedades con el estado de cada una". Eso requiere
  la entidad `Propiedad` (feature #6). *Suposición provisional:* se **excluye
  del alcance de #5**; `GET /propietarios/:id` no expone `propiedades` en esta
  feature y la parte de RF-C5 correspondiente se cubre en #6. ¿Se acepta el
  diferimiento, o se prefiere devolver ya un `propiedades: []` reservado?

- **PA-2 — Retención en la fuente: ¿por propietario o por tenant?** RF-C5 y
  RF-P1 mencionan "datos de retención" sin decir dónde vive la tarifa.
  *Suposición provisional:* `sujeto_retencion` (boolean) por propietario y
  `porcentaje_retencion` nullable por propietario. Si la tarifa es una
  configuración del tenant (o de la ley vigente por año), la columna
  `porcentaje_retencion` debe eliminarse en una migración posterior.

- **PA-3 — "Certificados" fiscales (RF-C5).** *Suposición provisional:* la
  generación/almacenamiento de certificados de retención es un asunto del
  módulo documental y queda **fuera del alcance** de #5. ¿Correcto?

- **PA-4 — Semántica de "crear si no existe" (RF-C6).** *Suposición
  provisional:* dos pasos — `GET` de búsqueda por documento (R18) y `POST`
  que responde 409 si ya existe (R19), como en el árbol de decisión del PRD
  §12.1 ("¿ya existe? → No: crear · Sí: asociar"). ¿Se prefiere en cambio un
  `POST` idempotente tipo upsert que devuelva 200 con el perfil existente?

- **PA-5 — ¿El propietario necesita email obligatorio?** RF-C4 exige correo
  para el inquilino; RF-C5 solo dice "datos personales/contacto". El modelo de
  identidad heredado de #3 tiene `user.email` NOT NULL UNIQUE. *Suposición
  provisional:* email **obligatorio también para el propietario**, para no
  debilitar la unicidad de la identidad. La alternativa (email nullable en
  `user`) obliga a revisar login y unicidad.

- **PA-6 — Codeudor/coarrendatario y referencias (RF-C4, "opcionalmente").**
  *Suposición provisional:* quedan **fuera del alcance** de #5 porque RF-C4
  los liga a la firma del contrato (features de contratos/firma). ¿Correcto?

- **PA-7 — Ubicación de `documento_identidad`.** El modelo preliminar del PRD
  §8.7 lo pone en `User` (global, sin tenant). *Suposición provisional:* vive
  en el perfil (`perfil_propietario` / `perfil_inquilino`), con unicidad
  **dentro** del tenant. Motivo: una restricción única global sobre el
  documento permitiría a un tenant descubrir por colisión que una persona
  existe en otro tenant, violando §11.3. Ver `design.md` §7.
