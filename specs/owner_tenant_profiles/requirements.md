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

Las consecuencias asumidas de D-5 y D-7 (posible identidad duplicada entre
tenants cuando el cliente no tiene email) están en `design.md` §7.3 como efecto
aceptado. Las preguntas abiertas que quedan tras la revisión están al final de
este archivo (**PA-8 … PA-11**).

---

# v4 — Ampliación tras la revisión (B1–B4)

> El `reviewer` **rechazó** la feature el 2026-07-27
> (`progress/review_owner_tenant_profiles.md`) con cuatro hallazgos críticos:
> dos invariantes de §C7 en rojo (aislamiento por tenant y auditoría inmutable)
> y su causa de fondo (la puerta verde no cubre `test:db`). **El humano decidió
> que los cuatro se arreglan dentro de #5**, no en una feature aparte
> (`design.md` §15).
>
> Los requirements R1–R37 y las tasks T1–T47 **ya están implementados y no se
> renumeran**. Todo lo que sigue es adición: **R38–R58**, con sus tasks
> **T48–T68**.

## Grupo H — B1: escritura entre tenants sobre la identidad compartida

> **Defecto (`review` §B1):** `propietarios.repository.ts:167` e
> `inquilinos.repository.ts:144` ejecutan `UPDATE "user" SET … WHERE id = $N`
> sin ninguna condición de tenant. Como R25 obliga a **reutilizar** la
> identidad de otra inmobiliaria cuando el email coincide, un `admin` del
> tenant A puede vincularse la identidad del admin del tenant B y después
> reescribirle el `email` —con el que se hace login— dejándolo fuera de su
> cuenta. Los 9 tests de acceso cruzado existentes no lo ven: solo tocan
> `perfil_*` y `cuenta_bancaria`.
>
> Nota para quien implemente: filtrar por *"la identidad tiene un `user_role`
> en mi tenant"* **NO cierra el ataque**, porque el paso 1 del ataque crea
> precisamente ese `user_role`. La condición tiene que ser de **exclusividad**.

### R38 — (RF-A1, RF-C3, §11.3) La identidad compartida no se puede reescribir

CUANDO se actualiza `nombre`, `email` o `telefono` de un propietario o un
inquilino, el sistema DEBE ejecutar el `UPDATE` sobre `user` únicamente si esa
identidad **no tiene ningún `user_role` en un tenant distinto** al de la
petición.

### R39 — (RF-A1, §11.3, PA-8) Rechazo explícito ante identidad compartida

SI se intenta actualizar `nombre`, `email` o `telefono` de una identidad
vinculada a otro tenant ENTONCES el sistema DEBE responder 409 con el código
`IDENTIDAD_COMPARTIDA_NO_EDITABLE` y NO DEBE modificar ninguna fila de `user`.

> Alcance provisional a la espera de **PA-8**: los campos del **perfil**
> (`documento`, `ciudad`, `sujeto_retencion`, `celular`,
> `medio_preferido_contacto`…) siguen siendo editables con normalidad, porque
> son del tenant. Solo se bloquean los tres campos que viven en la identidad
> global.

---

## Grupo I — B2: la auditoría no es inmutable en el producto

> **Defecto (`review` §B2):** `0004_auditoria.sql:4` afirma en un comentario que
> hay un trigger append-only. **Ese trigger no existe en ninguna migración**: lo
> crea el propio test en su `beforeAll` (`audit-log.test.ts:30-52`) y después
> afirma sobre él. Es un test verde por construcción: si se borrase el
> `CREATE TRIGGER` de la migración, el test seguiría pasando, porque la
> migración nunca lo tuvo. En producción `audit_log` es actualizable y
> borrable.

### R40 — (RF-W4, §11.3, C4) El trigger append-only lo crea una migración

EL sistema DEBE crear la función y los dos triggers `BEFORE UPDATE` y
`BEFORE DELETE` sobre `audit_log` en una **migración versionada**, no en el
código de ningún test.

### R41 — (RF-W4, §11.3) `audit_log` es inmutable también para el rol dueño

SI se ejecuta `UPDATE` o `DELETE` sobre `audit_log` ENTONCES el motor DEBE
abortar la sentencia con error, incluso cuando quien la ejecuta es el rol
propietario de la tabla o el rol de migración.

### R42 — (`docs/conventions.md`) La corrección no reescribe una migración aplicada

EL sistema DEBE corregir la afirmación falsa de la cabecera de
`0004_auditoria.sql` **desde la migración nueva** (nota explícita que declara
qué faltaba y dónde se añade), y NO DEBE editar el archivo de una migración ya
aplicada.

> Motivo técnico: el migrador de Drizzle identifica cada migración por el hash
> del archivo; editar `0004` —aunque sea solo un comentario— la convierte en una
> migración distinta para el runner. Ver `design.md` §17.

---

## Grupo J — B3: la aplicación se conecta como superusuario

> **Defecto (`review` §B3):** `FORCE ROW LEVEL SECURITY` alcanza al **dueño** de
> la tabla, no a un superusuario ni a un rol con `BYPASSRLS`. La app usa el
> usuario por defecto del contenedor (`.env.example:21`,
> `docker-compose.yml:18`), que es superusuario: **el RLS es inerte en
> ejecución**. Los tests HTTP heredan el defecto
> (`entorno-clientes.ts:74,134`), así que los 9 accesos cruzados que devuelven
> 404 miden el `WHERE tenant_id` del repositorio, no el motor.

### R43 — (D2, RF-A1, §11.3) Rol de aplicación sujeto a RLS

EL sistema DEBE conectarse a PostgreSQL, en ejecución normal, con un rol que
**no** sea superusuario, **no** tenga `BYPASSRLS` y **no** sea el dueño de las
tablas.

### R44 — (D2, §11.3) Arranque abortado si el rol evade el RLS

SI el rol de la conexión de la aplicación es superusuario o tiene `BYPASSRLS`
ENTONCES la aplicación DEBE abortar el arranque con un error de configuración
accionable.

### R45 — (D2, §11.3, `docs/conventions.md`) Privilegios mínimos

EL sistema DEBE conceder al rol de aplicación únicamente `SELECT`, `INSERT` y
`UPDATE` sobre las tablas de negocio, `SELECT` e `INSERT` sobre `audit_log`, y
NO DEBE concederle `DELETE` sobre ninguna tabla.

> El `DELETE` no se necesita: todas las bajas son lógicas (R14, R21) y las
> entidades con valor legal son inmutables (`docs/conventions.md`). Negarlo en
> el motor convierte esa convención en una barrera real.

### R46 — (D2) Provisión única y repetible del rol

EL sistema DEBE crear el rol de aplicación y aplicar sus `GRANT` mediante un
**único procedimiento de provisión**, ejecutado después de las migraciones, que
usan por igual el arranque local, la CI y los entornos de prueba.

> Se ejecuta *después* de cada migración porque los `GRANT` no alcanzan
> retroactivamente a las tablas que aún no existían.

### R47 — (D2, §11.3) Credenciales separadas para migrar y para servir

EL sistema DEBE usar una cadena de conexión distinta para las migraciones
(`DATABASE_MIGRATION_URL`, rol privilegiado) y para la aplicación
(`DATABASE_URL`, rol de aplicación), y NO DEBE incrustar ninguna de las dos en
el repositorio.

### R48 — (D2, RF-QA2) Los tests HTTP corren con el rol de aplicación

CUANDO un test levanta la aplicación NestJS contra PostgreSQL, el sistema DEBE
conectarla con el rol de aplicación sujeto a RLS, no con el rol privilegiado
del contenedor.

---

## Grupo K — B4: la política RLS de `user` contradice R6, R8, R22 y R25

> **Defecto (`review` §B4):** `user_tenant_isolation`
> (`0003_auth_rbac.sql:48-54`) es `FOR ALL` sin `WITH CHECK`, así que PostgreSQL
> reutiliza el `USING` como `WITH CHECK`. En cuanto el rol deje de ser
> superusuario (o sea: en cuanto se corrija B3) se rompen tres cosas: crear
> identidad es imposible (bloqueo circular con la FK de `user_role`), vincular
> por email entre tenants es imposible (R25), y **el login devuelve 401 a todo
> el mundo** porque `auth.service.ts:44` consulta `user` sin contexto de tenant.
> **B3 y B4 son inseparables** y su orden está fijado en `design.md` §16.

### R49 — (RF-C3, D2) Políticas de `user` explícitas por comando

EL sistema DEBE sustituir la política `FOR ALL` de `user` por políticas
explícitas por comando (`SELECT`, `INSERT`, `UPDATE`) con su `WITH CHECK` propio
donde aplique, y NO DEBE definir política de `DELETE` (la identidad no se
borra).

### R50 — (RF-A1, §11.3) El motor también impide reescribir identidad compartida

SI el rol de aplicación intenta un `UPDATE` sobre una fila de `user` cuya
identidad tiene `user_role` en otro tenant ENTONCES la política RLS DEBE
rechazar la sentencia, con independencia de lo que haga el código de
aplicación.

> Defensa en profundidad de **R38**: la misma regla escrita dos veces, una en el
> repositorio y otra en el motor. B1 existe justamente porque una sola capa se
> olvidó.

### R51 — (RF-AU1, RF-C3) El login sigue funcionando con RLS activo

CUANDO `POST /auth/login` recibe credenciales válidas y la aplicación corre con
el rol sujeto a RLS, el sistema DEBE responder 200 con `access_token`.

### R52 — (RF-AU1, RF-C3, §11.3) Ruta de identidad acotada

EL sistema DEBE resolver la identidad previa al contexto de tenant (login y
vinculación por email) mediante funciones `SECURITY DEFINER` de **coincidencia
exacta por email**, sin patrones, sin listados y sin devolver más columnas de
las que necesita cada caso de uso.

### R53 — (RF-C2, RF-AU6, RF-C6) La vinculación por email sigue cumpliéndose

CUANDO se crea un cliente cuyo email ya corresponde a un `user` existente y la
aplicación corre con el rol sujeto a RLS, el sistema DEBE reutilizar ese
`user_id` (R25) obteniéndolo por la función acotada, que DEBE devolver
únicamente el identificador.

### R54 — (RF-W4, §11.3) La vinculación de identidad queda auditada

CUANDO se reutiliza una identidad ya existente para darla de alta en otro
tenant, el sistema DEBE registrar en `audit_log` una entrada con
`accion = 'vincular_identidad'`, sin incluir el email en `metadata` (R36).

### R55 — (RF-C6, RF-PI2) La creación de identidad sigue siendo posible

CUANDO se crea un propietario o un inquilino con la aplicación corriendo bajo el
rol sujeto a RLS, el sistema DEBE insertar la fila de `user` y la de `user_role`
en la misma transacción sin que ninguna política las bloquee (R22 sigue
vigente).

---

## Grupo L — Causa de fondo: la puerta verde no veía nada de esto

### R56 — (C1, C4, RF-QA2) `test:db` entra en el semáforo

EL sistema DEBE ejecutar `npm run test:db` dentro de `./init.sh`, junto a
`lint`, `typecheck` y `test`.

> Cuatro tests de políticas RLS llevaban rotos desde #2/#3 —consultaban
> `pg_policies.polname`, columna inexistente— sin que nadie lo viera, porque esa
> suite estaba fuera de la puerta.

### R57 — (C4, §11.3) Ningún test fabrica el objeto que verifica

EL sistema NO DEBE crear, en el código de un test, el objeto de esquema
(trigger, función, política o rol) sobre el que ese mismo test hace su
afirmación: los invariantes se verifican contra el esquema que dejan las
migraciones y contra el rol creado por el procedimiento de provisión (R46).

> Queda permitida la **inyección de fallos** —crear un trigger que provoque un
> error para probar una reacción, como hace el test de atomicidad de R22—
> porque ahí el objeto creado es el *estímulo*, no el *sujeto* de la afirmación.
> La distinción se hace explícita con una lista blanca justificada (T49), no con
> el criterio del revisor de turno.

### R58 — (§C7, RF-QA2) Los invariantes se prueban con el rol de aplicación

EL sistema DEBE verificar los invariantes de §C7 que toca esta feature
(aislamiento, RBAC, auditoría inmutable y datos personales) ejecutando las
pruebas con el **rol de aplicación sin `BYPASSRLS`**, no con el rol
privilegiado.

---

## PREGUNTAS ABIERTAS tras la revisión (requieren decisión del humano)

Ninguna se ha resuelto por cuenta propia. Donde hacía falta elegir para poder
redactar, se marca la **opción mínima provisional** —la que satisface los
requirements existentes sin ampliar visibilidad— y qué cambia si el humano
decide otra cosa.

- **PA-8 — ¿De quién son los datos de contacto de una identidad compartida?**
  (bloquea B1). Hoy `nombre`, `email` y `telefono` viven en `user`, que es
  global, y el PATCH del perfil los edita. *Opción mínima provisional (R38,
  R39):* **se bloquean** con 409 en cuanto la identidad tiene rol en otro
  tenant. Alternativas: **(a)** copiar los datos de contacto al perfil, de modo
  que cada inmobiliaria tenga los suyos y `user` guarde solo la credencial;
  **(b)** que solo los edite el tenant que creó la identidad; **(c)** que
  `email` deje de ser editable desde el perfil en cualquier caso, por ser la
  credencial de acceso. La opción (a) es la única que evita el 409 en operación
  normal, pero cambia el esquema y contradice el "no se duplican" de R1.

- **PA-9 — ¿Qué puede saber una inmobiliaria de una identidad de otra?**
  (bloquea B4). R25/RF-C2/RF-AU6 obligan a reutilizar el `user` cuando el email
  coincide, aunque sea de otro tenant. *Opción mínima provisional (R52, R53):*
  una función acotada que, dado un email exacto, devuelve **solo el
  identificador** —lo que implica que el tenant A puede **confirmar que un email
  existe en el sistema**, aunque no vea de quién es—. Alternativas: **(a)**
  aceptar esa confirmación implícita como coste de RF-AU6; **(b)** no vincular
  nunca entre tenants (crear identidades separadas, lo que rompe R25 y RF-C2);
  **(c)** vincular solo tras verificación del titular (OTP al correo), lo que
  convierte "crear en línea" (RF-C6) en un flujo con espera. **Sin esta decisión
  no se puede escribir la política definitiva de `user`.**

- **PA-10 — ¿Puede un tenant vincularse una identidad ajena sin consentimiento?**
  El paso 1 de la cadena de ataque de B1 es legítimo según R25: basta conocer el
  email para insertar un `user_role` sobre la identidad del admin de otra
  inmobiliaria, que además queda visible en el `GET /propietarios/:id` del
  tenant atacante (nombre y teléfono de la identidad global). *Opción mínima
  provisional:* se permite —R25 lo exige— y se **audita** (R54). Alternativas:
  exigir consentimiento (ligado a PA-9c), o limitar lo que devuelve la ficha de
  un perfil cuya identidad es compartida. **PA-9 y PA-10 son la misma decisión
  de producto vista desde dos sitios; conviene contestarlas juntas.**

- **PA-11 — Gestión de la credencial del rol de aplicación** (B3). *Opción
  mínima provisional (R46, R47):* dos variables nuevas (`APP_DB_USER`,
  `APP_DB_PASSWORD`) en `.env.example` e `init.sh`, con el procedimiento de
  provisión leyéndolas del entorno; `DATABASE_URL` pasa a ser la del rol de
  aplicación y se añade `DATABASE_MIGRATION_URL`. ¿Se acepta este reparto, o se
  prefiere otro medio (gestor de secretos, autenticación por certificado, un
  único usuario con `SET ROLE`)? Afecta a `docker-compose.yml`, `.env.example`,
  `init.sh` y al despliegue.
