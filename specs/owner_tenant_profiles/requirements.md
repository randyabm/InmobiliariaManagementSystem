# Requirements — owner_tenant_profiles

> Feature #5. Hoja de vida de propietario e inquilino — **núcleo**.
> Anclaje al PRD: **RF-C1** (registro de clientes), **RF-C4** (datos del
> inquilino), **RF-C5** (hoja de vida del propietario), **RF-C6** (crear si no
> existe). Referencias de apoyo: RF-C2/RF-AU6 (identidad multi-rol),
> RF-C3/RF-A1 (RBAC + aislamiento), RF-P1 (grupo contable), RF-AU1 (login),
> RF-W4 y §11.3 (auditoría e invariantes), D2 (RLS), Ley 1581 de 2012.
>
> **v3 — la feature se partió en dos por decisión del humano.** Aquí vive el
> núcleo. La tarifa de retención, los codeudores/coarrendatarios y las
> referencias del inquilino se especifican en
> `specs/retencion_codeudor_referencias/` (feature **#25**). Este spec es
> autocontenido: no hace falta leer el otro para implementarlo.

Notación EARS estricta (`docs/specs.md`). Un solo `DEBE` por requirement.
Las decisiones del humano que fijan el alcance están al final (**DECISIONES**).

---

## Grupo A — Esquema de datos, RLS e identidad

### R1 — (RF-C5, RF-C1, D2, D-2) Tabla `perfil_propietario`

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
- `activo` boolean NOT NULL DEFAULT true
- `created_at` timestamptz NOT NULL DEFAULT now()
- `updated_at` timestamptz NOT NULL DEFAULT now()
- UNIQUE (`tenant_id`, `user_id`)
- UNIQUE (`tenant_id`, `tipo_documento`, `documento`)

La tabla NO DEBE tener columna de **tarifa** de retención
(`porcentaje_retencion` ni equivalente): por **D-2** la tarifa es
configuración del tenant y se especifica en la feature #25. Los datos de
contacto (`nombre`, `email`, `telefono`) no se duplican: viven en `user`
(feature #3).

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

### R6 — (RF-AU1, RF-C1) Identidad sin credenciales no permite login

MIENTRAS un registro de `user` tenga `password_hash` NULL (cliente registrado
como propietario o inquilino que aún no activó portal), el endpoint
`POST /auth/login` DEBE responder 401 para ese usuario sin evaluar ninguna
contraseña.

### R7 — (RF-C1, RF-C5, D-5) `user.email` opcional con unicidad preservada

EL sistema DEBE permitir `user.email` NULL y DEBE seguir rechazando dos
registros de `user` con el **mismo** email no nulo.

> Consecuencia de **D-5** (email del propietario opcional). Modifica el
> esquema entregado por la feature #3, ya cerrada: ver `design.md` §7.2.

### R8 — (RF-AU1, D-5) El login por email sigue siendo correcto

SI `POST /auth/login` recibe un `email` nulo, ausente o vacío ENTONCES el
sistema DEBE responder 401 y NO DEBE seleccionar ningún registro de `user`
cuyo `email` sea NULL.

### R9 — (RF-C1, RF-C5, D-5, D-7) Clave de identidad del cliente sin email

EL sistema DEBE identificar a un propietario o inquilino sin email por la
tripleta (`tenant_id`, `tipo_documento`, `documento`) de su perfil, y esa
tripleta DEBE ser única dentro del tenant.

---

## Grupo B — CRUD de propietario (RF-C5)

### R10 — (RF-C5, RF-C1, D-5) Crear propietario

CUANDO un usuario con rol `admin` o `empleado` envía `POST /propietarios` con
`nombre`, `tipo_documento` y `documento` —y opcionalmente `email`, `telefono`,
`direccion_notificacion`, `ciudad` y `sujeto_retencion`— el sistema DEBE crear
el perfil del propietario en el tenant de la petición y responder 201 con su
`id`.

### R11 — (RF-C5) Registrar cuenta bancaria del propietario

CUANDO un usuario autorizado envía
`POST /propietarios/:id/cuentas-bancarias` con `banco`, `tipo_cuenta`,
`numero_cuenta`, `titular_nombre`, `titular_tipo_documento` y
`titular_documento`, el sistema DEBE crear la cuenta asociada a ese
propietario y marcarla `es_predeterminada = true` si el propietario no tenía
ninguna cuenta predeterminada activa.

### R12 — (RF-C5, D-1, D-3) Consultar la hoja de vida del propietario

CUANDO un usuario autorizado invoca `GET /propietarios/:id`, el sistema DEBE
responder 200 con los datos personales, `sujeto_retencion`, la lista de
cuentas bancarias activas y la identificación de la predeterminada, y la
respuesta NO DEBE incluir ningún campo `propiedades` ni de certificados
fiscales (diferidos a #6 y al módulo contable).

### R13 — (RF-C5) Actualizar propietario

CUANDO un usuario autorizado envía `PATCH /propietarios/:id` con un
subconjunto de campos editables, el sistema DEBE aplicar solo esos campos y
actualizar `updated_at`.

### R14 — (RF-C5, `docs/conventions.md`) Baja lógica del propietario

CUANDO un usuario autorizado invoca `DELETE /propietarios/:id`, el sistema
DEBE marcar `activo = false` y NO DEBE ejecutar un borrado físico de la fila.

### R15 — (RF-C5) Cambiar la cuenta predeterminada

CUANDO un usuario autorizado invoca
`PATCH /propietarios/:idPropietario/cuentas-bancarias/:idCuenta` con
`es_predeterminada = true`, el sistema DEBE, en una sola transacción, quitar
la marca a la cuenta predeterminada anterior y ponerla en la indicada.

### R16 — (RF-C5) Marca de sujeto de retención

CUANDO se crea o actualiza un propietario con `sujeto_retencion`, el sistema
DEBE persistir ese booleano en su perfil.

### R17 — (RF-C5, D-2) Frontera con la feature #25: aquí no se calcula retención

EL sistema NO DEBE calcular, resolver ni aplicar ningún porcentaje de retención
en la fuente en esta feature: `sujeto_retencion` se captura y se devuelve, y su
consumo (tarifa por tenant y año) es alcance de la feature #25.

---

## Grupo C — CRUD de inquilino (RF-C4)

### R18 — (RF-C4, RF-C1) Crear inquilino con los campos mínimos

CUANDO un usuario con rol `admin` o `empleado` envía `POST /inquilinos` con
`nombre`, `tipo_documento`, `documento`, `email`, `celular` y
`medio_preferido_contacto`, el sistema DEBE crear el perfil del inquilino en el
tenant de la petición y responder 201 con su `id`.

### R19 — (RF-C4) Campos mínimos obligatorios del inquilino

SI `POST /inquilinos` omite cualquiera de `nombre`, `tipo_documento`,
`documento`, `email`, `celular` o `medio_preferido_contacto`, o envía un
`medio_preferido_contacto` fuera de {`CORREO`, `SMS`, `WHATSAPP`, `LLAMADA`},
ENTONCES el sistema DEBE responder 400 sin persistir ninguna fila.

> El email **sí** es obligatorio para el inquilino: RF-C4 lo exige de forma
> explícita. La opcionalidad de **D-5** aplica solo al propietario.

### R20 — (RF-C4) Actualizar inquilino

CUANDO un usuario autorizado envía `PATCH /inquilinos/:id` con un subconjunto
de campos editables (incluido `medio_preferido_contacto`), el sistema DEBE
aplicar solo esos campos y actualizar `updated_at`.

### R21 — (RF-C4, `docs/conventions.md`) Baja lógica del inquilino

CUANDO un usuario autorizado invoca `DELETE /inquilinos/:id`, el sistema DEBE
marcar `activo = false` y NO DEBE ejecutar un borrado físico de la fila.

---

## Grupo D — Crear en línea sin abandonar el flujo (RF-C6, RF-PI2, D-4)

### R22 — (RF-C6, RF-PI2) Creación atómica en una sola llamada

CUANDO se crea un propietario o un inquilino, el sistema DEBE escribir la
identidad (`user`), el rol del tenant (`user_role`) y el perfil
(`perfil_propietario` / `perfil_inquilino`) dentro de **una sola transacción**,
de modo que un fallo parcial no deje ninguna de las tres filas persistida.

### R23 — (RF-C6, D-4) Búsqueda previa por documento

CUANDO un usuario autorizado invoca
`GET /propietarios?tipo_documento=<t>&documento=<d>` o
`GET /inquilinos?tipo_documento=<t>&documento=<d>`, el sistema DEBE responder
200 con el perfil coincidente **del tenant de la petición** o con una lista
vacía si no existe en ese tenant.

### R24 — (RF-C6, D-4) Documento ya registrado en el tenant

SI `POST /propietarios` o `POST /inquilinos` envía un
(`tipo_documento`, `documento`) que ya tiene perfil en el tenant de la petición
ENTONCES el sistema DEBE responder 409 con el código `PERFIL_YA_EXISTE` y NO
DEBE crear un perfil duplicado.

### R25 — (RF-C2, RF-AU6, RF-C6) Reutilización de identidad por email sin fuga

CUANDO el `email` recibido ya corresponde a un `user` existente, el sistema
DEBE reutilizar ese `user_id` creando únicamente el `user_role` y el perfil del
tenant de la petición, y la respuesta NO DEBE incluir ningún dato proveniente
de perfiles de ese `user` en otros tenants.

### R26 — (RF-C6, D-5, D-7) Sin email no se vincula por documento

SI se crea un propietario sin `email` ENTONCES el sistema DEBE crear una
identidad `user` nueva y NO DEBE vincularla a ninguna identidad existente
buscándola por `documento`.

> Buscar por documento fuera del tenant revelaría que la persona ya es cliente
> de otra inmobiliaria (§11.3). Consecuencia asumida en `design.md` §7.3.

---

## Grupo E — Cuenta de giro del canon y punto de extensión hacia #6

> La entidad `Propiedad` es la feature #6 y **no existe todavía**. Esta feature
> entrega la cuenta por defecto a nivel de propietario y la **regla de
> resolución** con su punto de extensión (parámetro de override), probada de
> forma determinista. La columna `propiedad.cuenta_bancaria_id` que suministra
> el override la crea la feature #6. Ver `design.md` §6.

### R27 — (RF-C5, RF-P1) El override gana sobre la cuenta por defecto

CUANDO se invoca
`CuentasBancariasService.resolverCuentaDeGiro(perfilPropietarioId, cuentaOverrideId, ctx)`
con un `cuentaOverrideId` presente y válido, el sistema DEBE resolver esa
cuenta y NO la cuenta predeterminada del propietario.

### R28 — (RF-C5, RF-P1) Sin override se usa la cuenta por defecto

CUANDO se invoca `resolverCuentaDeGiro` sin `cuentaOverrideId`, el sistema DEBE
resolver la cuenta activa del propietario con `es_predeterminada = true`.

### R29 — (RF-C5, RF-A1) Override ajeno rechazado

SI el `cuentaOverrideId` recibido no pertenece al mismo `perfil_propietario_id`
y al mismo `tenant_id` de la petición ENTONCES el sistema DEBE lanzar
`CuentaDeGiroInvalidaError` y NO DEBE resolver esa cuenta.

### R30 — (RF-C5) Ausencia de cuenta resoluble

SI el propietario no tiene cuenta predeterminada activa y no se recibe override
ENTONCES el sistema DEBE lanzar `CuentaDeGiroInvalidaError` y NO DEBE devolver
`null` ni una cuenta arbitraria.

---

## Grupo F — Invariantes de seguridad (obligatorios, `docs/specs.md`)

### R31 — (RF-A1, RF-C3) Aislamiento por tenant

SI una petición autenticada en el tenant A solicita, modifica o da de baja
cualquier fila de `perfil_propietario`, `perfil_inquilino` o `cuenta_bancaria`
del tenant B ENTONCES el sistema DEBE responder 404 sin revelar su existencia.

### R32 — (RF-C3, §11.3) Autorización por rol en el backend

SI un usuario cuyo único rol activo en el tenant es `propietario` o `inquilino`
invoca cualquier endpoint de `/propietarios` o `/inquilinos` ENTONCES el
sistema DEBE rechazar la petición en el backend con 403.

### R33 — (RF-AU6, RF-C3) Resolución del tenant de la petición

SI el header `x-tenant-id` de una petición autenticada no corresponde a ningún
rol activo del JWT ENTONCES el sistema DEBE responder 403 y NO DEBE ejecutar
ninguna consulta de negocio.

### R34 — (D2, RF-C3, `docs/architecture.md`) Sin contexto de tenant, falla

SI un repositorio de esta feature se ejecuta sin contexto de tenant establecido
(`app.current_tenant` no fijado en la conexión) ENTONCES el sistema DEBE fallar
con `SinContextoDeTenantError` y NO DEBE consultar la base de datos con una
conexión del pool sin `SET LOCAL`.

### R35 — (RF-W4, §11.3) Auditoría de acciones críticas

CUANDO se crea, actualiza o da de baja un `perfil_propietario`, un
`perfil_inquilino` o una `cuenta_bancaria`, el sistema DEBE registrar una
entrada en `audit_log` con `tenant_id`, `actor_id`, `accion`, `entity_type` y
`entity_id` del recurso afectado.

### R36 — (§11.3, Ley 1581 de 2012) Datos personales fuera de logs y auditoría

EL sistema NO DEBE incluir `documento`, `titular_documento`, `celular`,
`telefono`, `email` ni `numero_cuenta` en los logs de aplicación ni en el campo
`metadata` de `audit_log`.

---

## Grupo G — Gobernanza del cambio

### R37 — (D2, `docs/conventions.md`, C4/C6) Migración versionada y verificada

EL sistema DEBE aplicar todos los cambios de esquema de esta feature en una
única migración versionada, forward-only e idempotente
(`0005_owner_tenant_profiles.sql`), y las listas de control existentes
(`TABLAS_PERMITIDAS` en `tests/migrations.test.ts` y `RUTAS_PERMITIDAS` en
`routes-surface.test.ts`) DEBEN actualizarse con las tres tablas y las 13 rutas
nuevas en el mismo cambio.

---

## DECISIONES DEL HUMANO

Las siete decisiones (D-1 … D-7) se tomaron sobre el spec unificado, antes del
corte en #5 y #25. Se conservan íntegras con su motivo; la última columna
indica dónde aplica cada una ahora.

| Id | Pregunta | Decisión | Motivo dado | Dónde aplica |
|---|---|---|---|---|
| **D-1** | Lista de propiedades del propietario (RF-C5) | **Diferida a #6.** #5 no expone `propiedades`, ni siquiera un array vacío reservado. | La entidad `Propiedad` no existe; un campo reservado sería API muerta. | **#5** — R12 lo prohíbe; `design.md` §10. |
| **D-2** | ¿Retención por propietario o por tenant? | **Por tenant.** `sujeto_retencion` (boolean) se queda en el propietario; el perfil no lleva columna de tarifa. | La tarifa la fija la ley y cambia por año; una copia por propietario se desincroniza. | **Repartida:** columna `sujeto_retencion` y prohibición de columna de tarifa en **#5** (R1, R16, R17); tabla `tarifa_retencion`, endpoints y resolución en **#25**. |
| **D-3** | Certificados fiscales (RF-C5) | **Diferidos al módulo contable.** Se guardan solo los datos fiscales. | Generar o almacenar certificados es asunto documental-contable. | **#5** — R12 lo excluye; `design.md` §10. |
| **D-4** | Semántica de "crear si no existe" (RF-C6) | **Dos pasos:** GET por documento + POST con 409 `PERFIL_YA_EXISTE`. Sin upsert. | Reproduce el árbol de decisión del PRD §12.1. | **#5** — R23, R24. |
| **D-5** | ¿Email obligatorio para el propietario? | **Opcional.** Implica relajar `user.email` a NULL-able conservando la unicidad de los no nulos, revisar el login de #3 y definir la clave de identidad sin email. | Hay propietarios reales sin correo; obligarlo produce datos falsos. | **#5** — R7, R8, R9, R10, R26; `design.md` §7.2 y §7.3. |
| **D-6** | Codeudor/coarrendatario y referencias (RF-C4) | **Entran en el producto, solo como captura de datos.** El amarre a la firma queda en #14/#17. | RF-C4 los lista como parte de los datos del inquilino. | **#25** — íntegramente. #5 no crea sus tablas ni sus rutas. |
| **D-7** | Ubicación de `documento_identidad` | Vive en el **perfil**, único **dentro** del tenant. Desviación consciente del PRD §8.7, aprobada explícitamente por el humano. | Una unicidad global del documento permitiría descubrir por colisión que una persona es cliente de otro tenant (§11.3). | **#5** — R1, R2, R9, R26; `design.md` §7.1. #25 aplica el mismo criterio a sus tablas. |

**No quedan preguntas abiertas.** Las consecuencias asumidas de D-5 y D-7
(posible identidad duplicada entre tenants cuando el cliente no tiene email)
están en `design.md` §7.3 como efecto aceptado, no como ambigüedad pendiente.
