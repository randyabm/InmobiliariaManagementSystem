# Design — owner_tenant_profiles

> Feature #5. Hoja de vida de propietario e inquilino.
> Este documento asume `docs/architecture.md` y `docs/conventions.md`; solo
> documenta los puntos donde la feature roza sus fronteras.
> **v2 — incorpora las 7 decisiones del humano (D-1 … D-7 de
> `requirements.md`).**

---

## 1. Encaje con lo que ya existe

Esta feature es la **primera con endpoints de negocio reales**. Se apoya en lo
ya construido y **no** propone un diseño paralelo:

| Ya existe (feature) | Cómo se reutiliza aquí |
|---|---|
| `tenant` + RLS por `app.current_tenant` (#2) | Las seis tablas nuevas llevan `tenant_id` y la misma política RLS, con `FORCE`. |
| `user` + `user_role` + JWT + `RolesGuard` + `@Roles` (#3) | La identidad del propietario/inquilino es un `user`; su relación con la inmobiliaria es un `user_role` (`rol` = `propietario` / `inquilino`). Los endpoints usan `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(...)`. |
| `audit_log` append-only + `AuditService` + `@Audit` (#4) | Las mutaciones de perfil, cuenta bancaria, codeudor, referencia y tarifa se auditan con el decorador existente; no se crea otro mecanismo. |
| `AppError` / `ResourceNotFoundError` + `AllExceptionsFilter` | Se reutilizan; los errores nuevos heredan de `AppError` (el filtro ya traduce `code` + `httpStatus` + mensaje en español). |
| `TenantContextInterceptor` (#2/#3) | Se **registra globalmente** (ver §3): hoy existe pero no está enganchado a la app. |

### Deuda heredada que esta feature debe cerrar (aprobado por el humano)

1. **`TenantContextInterceptor` no está registrado.** `grep` confirma que
   ninguna parte de `bootstrap.ts`/`app.module.ts` lo usa. Mientras no había
   endpoints de negocio era inocuo; con `/propietarios` sería un agujero de
   aislamiento. Se registra como `APP_INTERCEPTOR` en `AppModule`.
2. **El tenant se elegía como `user.roles[0].tenant_id`.** Con identidad
   multi-tenant (RF-AU6) eso es incorrecto: un usuario con roles en dos
   inmobiliarias acabaría escribiendo en la equivocada. Se cambia a: tenant =
   header `x-tenant-id`, validado contra los roles activos del JWT; si el JWT
   tiene exactamente un tenant y no hay header, se usa ese; cualquier otro caso
   → 403 (**R40**).
3. **`user.email` y `user.password_hash` se relajan a NULL-able** (**D-5**,
   R9–R11). Esto modifica el esquema de la feature #3, ya cerrada: §7.
4. **`AuthService` consulta con el pool crudo**, sin `SET LOCAL`. No se
   refactoriza (el login es pre-tenant por naturaleza), pero sí se corrige su
   lógica por D-5/R11. **Los repositorios nuevos no pueden usar el pool**: usan
   el cliente de la transacción (§3, **R41**).

---

## 2. Ubicación del módulo

```
apps/api/src/modules/core/clientes/
```

Va dentro de `core/` y no como `modules/clientes/` porque:

- Es funcionalidad **Core** del PRD (§6.2), no un paquete comercial
  desactivable.
- La feature #6 (`properties`) necesitará resolver la cuenta de giro del
  propietario. `core/` no depende de nadie y **todos** dependen de `core/`
  (`docs/architecture.md`), así que `properties → core/clientes` es una
  dependencia legal; `properties → modules/clientes` obligaría a inventar un
  contrato entre módulos hermanos.

Estructura (convención de `docs/conventions.md`):

```
modules/core/clientes/
├── clientes.module.ts
├── propietarios.{controller,service,repository}.ts
├── inquilinos.{controller,service,repository}.ts
├── cuentas-bancarias.{controller,service,repository}.ts
├── codeudores.{controller,service,repository}.ts        # D-6
├── referencias.{controller,service,repository}.ts       # D-6
├── retencion.{controller,service,repository}.ts         # D-2
├── identidad.service.ts          # crear-o-vincular user + user_role
├── dto/                          # esquemas zod (zod ya es dependencia)
├── errors/
└── __tests__/
```

---

## 3. Acceso a datos: el contexto de tenant es obligatorio

`TenantContextInterceptor` ya abre una transacción, ejecuta
`SET LOCAL app.current_tenant` y deja el cliente en `request.tenantClient`.
Se añade un único helper compartido:

```ts
// apps/api/src/common/database/cliente-tenant.ts
export function obtenerClienteTenant(request: unknown): PoolClient;
// lanza SinContextoDeTenantError si request.tenantClient no existe
```

**Regla dura de esta feature:** ningún repositorio de `clientes/` llama a
`getDatabasePool()`. Todos reciben el `PoolClient` de la transacción. Así la
consulta sin contexto **falla** en vez de devolver filas de más
(`docs/architecture.md`, **R41**).

Los repositorios son el único lugar con SQL. Se usa SQL parametrizado sobre
`PoolClient` (no `drizzle(pool)`), porque Drizzle sobre el pool abriría una
conexión distinta de la que tiene el `SET LOCAL`. Los esquemas Drizzle se
mantienen como **fuente declarativa del esquema** (`database/schema/`), igual
que en #2–#4.

---

## 4. Migración `0005_owner_tenant_profiles.sql`

Forward-only e idempotente. **Sí habilita RLS** (`ENABLE` + `FORCE` + política
por `tenant_id`) en las seis tablas nuevas, en la misma migración que las crea
(**R8**, `docs/conventions.md`).

Contenido:

1. `ALTER TABLE "user" ALTER COLUMN "password_hash" DROP NOT NULL;`
   — un cliente (RF-C1) se registra sin credenciales. Contrapartida obligatoria:
   **R9** (login 401 si `password_hash IS NULL`).
2. `ALTER TABLE "user" ALTER COLUMN "email" DROP NOT NULL;` (**D-5**)
   — la restricción `UNIQUE` existente **se conserva sin cambios**: en
   PostgreSQL, `UNIQUE` trata cada NULL como distinto, así que varios usuarios
   sin email conviven y dos emails iguales no nulos siguen colisionando
   (**R10**). No se necesita índice parcial. Contrapartida obligatoria: **R11**.
3. `CREATE TABLE IF NOT EXISTS perfil_propietario (...)` — campos de **R1**,
   **sin** `porcentaje_retencion` (**D-2**).
4. `CREATE TABLE IF NOT EXISTS perfil_inquilino (...)` — campos de **R2**.
5. `CREATE TABLE IF NOT EXISTS cuenta_bancaria (...)` — campos de **R3**.
6. `CREATE TABLE IF NOT EXISTS codeudor_inquilino (...)` — **R5** (D-6).
7. `CREATE TABLE IF NOT EXISTS referencia_inquilino (...)` — **R6** (D-6).
8. `CREATE TABLE IF NOT EXISTS tarifa_retencion (...)` — **R7** (D-2).
9. RLS en las seis: `ENABLE`, `FORCE` y política
   `USING (tenant_id = current_setting('app.current_tenant', true)::uuid)`,
   con el mismo patrón `DO $$ IF NOT EXISTS (SELECT 1 FROM pg_policies ...)`
   de `0003`/`0004`.
10. Índice único parcial (**R4**):
    ```sql
    CREATE UNIQUE INDEX IF NOT EXISTS cuenta_bancaria_predeterminada_key
      ON cuenta_bancaria (perfil_propietario_id)
      WHERE es_predeterminada AND activa;
    ```
11. Índices de consulta: `perfil_propietario (tenant_id, documento)`,
    `perfil_inquilino (tenant_id, documento)`,
    `cuenta_bancaria (tenant_id, perfil_propietario_id)`,
    `codeudor_inquilino (tenant_id, perfil_inquilino_id)`,
    `referencia_inquilino (tenant_id, perfil_inquilino_id)`.
12. Entrada nueva en `apps/api/drizzle/meta/_journal.json`.

`tarifa_retencion.porcentaje` es `numeric(5,2)` — nunca `float`
(`docs/conventions.md`, "Dinero y fechas"). Todas las fechas `timestamptz`.
`anio` es `integer` (año calendario), no fecha: la tarifa aplica al año fiscal
completo.

---

## 5. Superficie HTTP (23 rutas)

Todos los endpoints: `@UseGuards(JwtAuthGuard, RolesGuard)`. Roles
`admin`/`empleado` salvo `/configuracion/retencion`, que es **solo `admin`**
(**R39**). Validación de entrada con zod en el borde. Rutas en kebab-case y
plural.

| Método y ruta | Servicio | Requirements | Auditoría |
|---|---|---|---|
| `POST /propietarios` | `PropietariosService.crear` | R13, R19, R29, R31, R32, R33 | `@Audit('crear','perfil_propietario')` |
| `GET /propietarios` (`?tipo_documento&documento`) | `.buscar` | R30, R38 | — |
| `GET /propietarios/:id` | `.obtener` | R15, R38 | — |
| `PATCH /propietarios/:id` | `.actualizar` | R16, R19, R38 | `@Audit('actualizar','perfil_propietario')` |
| `DELETE /propietarios/:id` | `.darDeBaja` | R17, R38 | `@Audit('baja','perfil_propietario')` |
| `POST /propietarios/:id/cuentas-bancarias` | `CuentasBancariasService.crear` | R14, R38 | `@Audit('crear','cuenta_bancaria')` |
| `GET /propietarios/:id/cuentas-bancarias` | `.listar` | R15, R38 | — |
| `PATCH /propietarios/:idPropietario/cuentas-bancarias/:idCuenta` | `.actualizar` | R18, R38 | `@Audit('actualizar','cuenta_bancaria')` |
| `POST /inquilinos` | `InquilinosService.crear` | R22, R23, R29, R31, R32 | `@Audit('crear','perfil_inquilino')` |
| `GET /inquilinos` (`?tipo_documento&documento`) | `.buscar` | R30, R38 | — |
| `GET /inquilinos/:id` | `.obtener` | R38 | — |
| `PATCH /inquilinos/:id` | `.actualizar` | R24, R38 | `@Audit('actualizar','perfil_inquilino')` |
| `DELETE /inquilinos/:id` | `.darDeBaja` | R25, R38 | `@Audit('baja','perfil_inquilino')` |
| `POST /inquilinos/:id/codeudores` | `CodeudoresService.crear` | R26, R28, R38 | `@Audit('crear','codeudor_inquilino')` |
| `GET /inquilinos/:id/codeudores` | `.listar` | R26, R38 | — |
| `PATCH /inquilinos/:idInquilino/codeudores/:idCodeudor` | `.actualizar` | R26, R38 | `@Audit('actualizar','codeudor_inquilino')` |
| `DELETE /inquilinos/:idInquilino/codeudores/:idCodeudor` | `.darDeBaja` | R26, R38 | `@Audit('baja','codeudor_inquilino')` |
| `POST /inquilinos/:id/referencias` | `ReferenciasService.crear` | R27, R28, R38 | `@Audit('crear','referencia_inquilino')` |
| `GET /inquilinos/:id/referencias` | `.listar` | R27, R38 | — |
| `PATCH /inquilinos/:idInquilino/referencias/:idReferencia` | `.actualizar` | R27, R38 | `@Audit('actualizar','referencia_inquilino')` |
| `DELETE /inquilinos/:idInquilino/referencias/:idReferencia` | `.darDeBaja` | R27, R38 | `@Audit('baja','referencia_inquilino')` |
| `GET /configuracion/retencion` | `RetencionService.listar` | R20, R38, R39 | — |
| `PUT /configuracion/retencion/:anio` | `RetencionService.establecer` | R20, R38, R39 | `@Audit('actualizar','tarifa_retencion')` |

`RUTAS_PERMITIDAS` en
`apps/api/src/modules/core/__tests__/routes-surface.test.ts` se amplía con
estas **23** rutas (**R44**).

### Firmas nuevas relevantes

```ts
// identidad.service.ts — RF-C6 / R29 / R32 / R33
crearOVincularIdentidad(
  cliente: PoolClient,
  datos: { nombre: string; email?: string | null; telefono?: string },
  tenantId: string,
  rol: 'propietario' | 'inquilino',
): Promise<{ userId: string; reutilizada: boolean }>;
// Vincula SOLO por email no nulo. Sin email → identidad nueva (R33).

// propietarios.service.ts
crear(dto: CrearPropietarioDto, ctx: ContextoPeticion): Promise<PerfilPropietario>;
obtener(id: string, ctx: ContextoPeticion): Promise<HojaDeVidaPropietario>;
buscarPorDocumento(tipo: TipoDocumento, documento: string, ctx: ContextoPeticion): Promise<PerfilPropietario[]>;
actualizar(id: string, dto: ActualizarPropietarioDto, ctx: ContextoPeticion): Promise<PerfilPropietario>;
darDeBaja(id: string, ctx: ContextoPeticion): Promise<void>;

// cuentas-bancarias.service.ts — punto de extensión hacia #6
resolverCuentaDeGiro(
  perfilPropietarioId: string,
  cuentaOverrideId: string | null,
  ctx: ContextoPeticion,
): Promise<CuentaBancaria>;   // nunca null: lanza CuentaDeGiroInvalidaError

// retencion.service.ts — D-2
establecer(anio: number, porcentaje: string, ctx: ContextoPeticion): Promise<TarifaRetencion>;
listar(ctx: ContextoPeticion): Promise<TarifaRetencion[]>;
resolverPorcentaje(anio: number, ctx: ContextoPeticion): Promise<string>; // lanza TarifaRetencionNoConfiguradaError
```

`crearOVincularIdentidad` recibe el `PoolClient` explícitamente para que la
identidad, el rol y el perfil ocurran en **la misma transacción** (**R29**).
`porcentaje` se maneja como `string` en la frontera para no perder precisión
al pasar por `number` (`numeric` de PostgreSQL, `docs/conventions.md`).

Tipos compartidos con el frontend (`TipoDocumento`, `MedioPreferidoContacto`,
`PerfilPropietario`, `PerfilInquilino`, `CuentaBancaria`, `CodeudorInquilino`,
`ReferenciaInquilino`, `TarifaRetencion`) van a `packages/types`
(`docs/conventions.md`), no se duplican en la app web.

---

## 6. El override de cuenta bancaria sin la entidad Propiedad (decisión clave)

El cuarto criterio de aceptación ("la cuenta bancaria del propietario puede
sobrescribirse a nivel de propiedad") depende de `Propiedad`, que es la
**feature #6** y no existe. El PRD ya dice **dónde** vive el override:
RF-P1, grupo *Contable* — "cuenta bancaria destino del canon (por defecto la
del propietario, con override por propiedad)" — y §13.4: "`BankAccount`
asociada por defecto al propietario y sobrescribible por propiedad".

**Decisión.** Esta feature entrega:

1. La cuenta **por defecto a nivel de propietario** (`cuenta_bancaria` +
   índice único parcial de una sola predeterminada, R3/R4/R14/R18).
2. La **regla de precedencia** como código propio y probado:
   `resolverCuentaDeGiro(perfilPropietarioId, cuentaOverrideId)` — el override
   gana; si no hay, la predeterminada; si no hay ninguna o el override es
   ajeno, error (R34–R37).
3. La validación de pertenencia (`mismo propietario` + `mismo tenant`) para que
   #6 no pueda enchufar una cuenta ajena (R36).

Lo que #6 debe añadir (queda anotado como **dependencia explícita**):

- Columna `propiedad.cuenta_bancaria_id uuid NULL REFERENCES cuenta_bancaria(id)`
  en la migración de #6.
- Llamada
  `resolverCuentaDeGiro(propiedad.perfil_propietario_id, propiedad.cuenta_bancaria_id)`
  en el punto donde se calcula el giro del canon.
- Un test de integración que verifique el override *a través de* la propiedad.

Así el punto de extensión queda **modelado y probado hoy** sin inventar ni un
solo campo de `Propiedad`.

### Alternativa descartada (obligatoria por `docs/specs.md`)

**Descartada: añadir ya `cuenta_bancaria.propiedad_id uuid NULL`** y crear la
FK después, en #6.

Motivos del descarte:
- Dejaría una columna sin FK durante toda la vida de #5, es decir un agujero de
  integridad referencial que nada impide llenar con basura, y **el propio RLS
  no lo cubriría** (no hay tabla contra la que validar el tenant).
- Invierte la dirección del PRD: el override es un atributo **de la propiedad**
  (RF-P1, grupo contable), no de la cuenta. Con `propiedad_id` en la cuenta,
  "¿qué cuenta usa esta propiedad?" pasa a ser una búsqueda inversa con reglas
  ambiguas si hubiera varias filas.
- No se puede probar de forma determinista hoy: sin `Propiedad` no hay ningún
  valor legítimo que poner en la columna, así que el criterio de aceptación
  quedaría "cubierto" solo de palabra.

**Segunda alternativa descartada:** tabla polimórfica
`cuenta_bancaria_asignacion(alcance, alcance_id)`. Resuelve el override
genéricamente, pero renuncia a la FK (mismo problema de integridad) y añade una
indirección que el PRD no pide para un único caso de uso conocido.

**Tercera alternativa descartada (D-2):** dejar `porcentaje_retencion` en el
perfil del propietario, como proponía la v1 de este spec. El humano lo vetó: la
tarifa la fija la ley y cambia por año, así que una copia por propietario se
desincroniza en silencio y produce cálculos de giro incorrectos. La tarifa vive
en `tarifa_retencion (tenant_id, anio)` y el perfil conserva solo la marca
booleana `sujeto_retencion`. Consecuencia coherente con el PRD §13.5, que ya
prevé "carga manual anual por el admin" para el IPC.

---

## 7. Modelo de identidad: decisiones y consecuencias asumidas

### 7.1 `documento_identidad` en el perfil, no en `user` (D-7, aprobado)

El modelo *preliminar* del PRD §8.7 lo pone en `User` (global, sin
`tenant_id`). Aquí vive en el perfil, con
`UNIQUE (tenant_id, tipo_documento, documento)`. **Es una desviación consciente
del PRD §8.7, aprobada explícitamente por el humano (D-7).** Razón: una
unicidad **global** sobre el documento haría que el intento de registrar a una
persona ya registrada en otra inmobiliaria fallara por colisión, revelando su
existencia — exactamente lo que prohíbe §11.3 y `docs/conventions.md` ("no
confirmes la existencia de recursos ajenos").

### 7.2 Email opcional para el propietario (D-5, cambia la feature #3)

`user.email` pasa a NULL-able conservando `UNIQUE` (§4, punto 2). Esto
**modifica el contrato de una feature ya cerrada**:

- `specs/auth_rbac/requirements.md` R1 dice "`email` text NOT NULL UNIQUE".
  Queda **superado por R10 de esta feature**. El `implementer` debe añadir una
  nota de enmienda en `specs/auth_rbac/requirements.md` (igual que
  `docs/conventions.md` fue enmendado tras la feature #1) para que el estado
  del repositorio no quede contradictorio.
- `AuthService.login` debe rechazar 401 cuando el email recibido es nulo o
  vacío, sin que la consulta pueda casar `email IS NULL` (**R11**), y cuando
  `password_hash IS NULL` (**R9**).
- El payload JWT (`specs/auth_rbac` R4) incluye `email`. Para clientes sin
  email no se emite token en esta feature (no hay portal todavía: RF-AU2/AU4
  son features posteriores), así que el payload no cambia. **Queda anotado como
  dependencia** para la feature del portal: tendrá que decidir el identificador
  del token de un cliente sin email.
- `audit_log.actor_email` ya es NULL-able, así que la auditoría no requiere
  cambios.

### 7.3 Clave de identidad sin email (D-5, R12)

Un propietario sin email se identifica por
(`tenant_id`, `tipo_documento`, `documento`) de su perfil. **Consecuencia
asumida:** al no poder buscar por documento fuera del tenant (**R33**, §11.3),
la misma persona física registrada sin email en dos inmobiliarias produce **dos
filas de `user`**. Eso tensiona RF-C2/RF-AU6 ("identidad única multi-tenant"):
la deduplicación de identidad solo es posible cuando hay email. Es un efecto
directo de D-5 + D-7, aceptado, no una ambigüedad pendiente; si más adelante se
quiere unificar, el camino es un proceso de fusión de identidades explícito y
auditado, no una unicidad global de documento.

### 7.4 Un `user`, varios perfiles

Un `user` puede tener perfil de propietario y de inquilino en el mismo tenant
(RF-C2). Por eso `UNIQUE (tenant_id, user_id)` es por tabla de perfil, no
compartida, y `user_role` (con su `UNIQUE(user_id, tenant_id, rol)` existente)
admite ambos roles.

---

## 8. Errores de dominio

Reutilizados:

- `ResourceNotFoundError` (404) — perfil, cuenta, codeudor, referencia o tarifa
  inexistente **o de otro tenant** (**R38**). No se crea un error distinto para
  el caso cross-tenant: la respuesta debe ser indistinguible.

Nuevos, en `modules/core/clientes/errors/` heredando de `AppError`:

| Error | `code` | HTTP | Cuándo |
|---|---|---|---|
| `PerfilYaExisteError` | `PERFIL_YA_EXISTE` | 409 | R31 — documento ya con perfil en el tenant |
| `CuentaDeGiroInvalidaError` | `CUENTA_DE_GIRO_INVALIDA` | 400 | R36, R37 — override ajeno o sin cuenta resoluble |
| `TarifaRetencionNoConfiguradaError` | `TARIFA_RETENCION_NO_CONFIGURADA` | 409 | R21 — el tenant no configuró la tarifa del año |
| `SinContextoDeTenantError` | `SIN_CONTEXTO_DE_TENANT` | 500 | R41 — repositorio invocado sin `tenantClient` (defecto de programación, no condición esperada) |

`AllExceptionsFilter` ya traduce `AppError` (mensaje propio si `status < 500`),
así que no se toca. `SinContextoDeTenantError` cae en el 500 genérico a
propósito: no debe filtrar detalle al cliente.

---

## 9. Frontera de codeudores y referencias (D-6)

**Dentro de #5:** modelado (`codeudor_inquilino`, `referencia_inquilino`), RLS,
CRUD expuesto, auditoría y aislamiento. Es **captura de datos** de la hoja de
vida del inquilino (RF-C4).

**Fuera de #5**, explícitamente:

- Cualquier FK hacia contrato, firma, inventario u OTP. Las dos tablas nuevas
  **no** referencian ninguna entidad de #14/#17 (**R28**).
- La condición legal de codeudor como firmante (RF-CT4, RF-C4 "ligado a la
  firma") y la verificación de identidad previa a la firma (RF-AU3).
- Notificaciones al codeudor (RF-N1).

**Dependencia registrada para #14/#17:** deberán añadir la relación
codeudor ↔ firmante (previsiblemente una FK desde la tabla de firmas hacia
`codeudor_inquilino`), no al revés, para no invertir la dirección de
dependencia entre módulos.

---

## 10. Cobertura parcial de RF-C5 (huecos conocidos, D-1 y D-3)

RF-C5 tiene cuatro partes: datos personales/contacto, datos bancarios, datos
fiscales y **lista de propiedades con su estado**. Tras las decisiones del
humano:

| Parte de RF-C5 | Estado en #5 | Dónde se completa |
|---|---|---|
| Datos personales / contacto | Cubierto (R1, R13, R15) | — |
| Datos bancarios (por defecto + override) | Cubierto el defecto y la regla de override (R3, R14, R18, R34–R37) | #6 aporta `propiedad.cuenta_bancaria_id` (§6) |
| Datos fiscales | Cubierta la marca `sujeto_retencion` y la tarifa del tenant (R7, R19–R21) | **Certificados de retención: diferidos al módulo contable (D-3)** |
| Lista de propiedades y su estado | **No cubierto a propósito (D-1)**; R15 prohíbe exponer el campo | **Feature #6** |

**Instrucción para el `reviewer`:** RF-C5 **no** debe marcarse como
completamente cubierto al cerrar #5. Estas dos casillas se cierran en #6 y en el
módulo contable.

---

## 11. Seguridad y datos personales

- **Aislamiento:** RLS `FORCE` en las seis tablas + repositorios que solo usan
  el cliente con `SET LOCAL`. El test de aislamiento se hace contra PostgreSQL
  real (Testcontainers) con un rol sin `BYPASSRLS`, como en
  `audit-log.test.ts`.
- **RBAC:** `@Roles('admin','empleado')` en 21 endpoints y `@Roles('admin')` en
  los 2 de `/configuracion/retencion`. El test de rechazo por rol es
  determinista (comparación de códigos 401/403, sin juicio de modelo).
- **Auditoría:** `@Audit(...)` en las 13 mutaciones. `metadata` solo lleva
  identificadores y nombres de campo modificados — **jamás** valores de
  `documento`, `celular`, `telefono`, `email` ni `numero_cuenta` (**R43**).
- **`numero_cuenta`** se guarda en columna `text` en claro; el cifrado en
  reposo se resuelve a nivel de almacenamiento (NFR §7), no por columna. No se
  registra en logs ni en auditoría, y solo lo devuelven los endpoints de
  `/cuentas-bancarias` a roles `admin`/`empleado`.
- **Logs:** se mantiene la regla de `docs/conventions.md` — `tenant_id` y
  `request_id`, nunca datos personales.

---

## 12. Dependencias nuevas

**Ninguna.** `zod` (validación de DTOs), `pg`, `drizzle-orm`, `@nestjs/*`,
`@testcontainers/postgresql` y `supertest` ya están en
`apps/api/package.json`.

---

## 13. Archivos

### Se crean

```
apps/api/drizzle/0005_owner_tenant_profiles.sql
apps/api/src/database/schema/perfil-propietario.ts
apps/api/src/database/schema/perfil-inquilino.ts
apps/api/src/database/schema/cuenta-bancaria.ts
apps/api/src/database/schema/codeudor-inquilino.ts
apps/api/src/database/schema/referencia-inquilino.ts
apps/api/src/database/schema/tarifa-retencion.ts
apps/api/src/common/database/cliente-tenant.ts
apps/api/src/modules/core/clientes/clientes.module.ts
apps/api/src/modules/core/clientes/identidad.service.ts
apps/api/src/modules/core/clientes/propietarios.{controller,service,repository}.ts
apps/api/src/modules/core/clientes/inquilinos.{controller,service,repository}.ts
apps/api/src/modules/core/clientes/cuentas-bancarias.{controller,service,repository}.ts
apps/api/src/modules/core/clientes/codeudores.{controller,service,repository}.ts
apps/api/src/modules/core/clientes/referencias.{controller,service,repository}.ts
apps/api/src/modules/core/clientes/retencion.{controller,service,repository}.ts
apps/api/src/modules/core/clientes/dto/*.ts
apps/api/src/modules/core/clientes/errors/*.ts
apps/api/src/modules/core/clientes/__tests__/*.test.ts
apps/api/src/database/__tests__/clientes-rls.test.ts
packages/types/src/clientes.ts
```

### Se modifican

```
apps/api/src/database/schema/index.ts              (exportar los 6 esquemas)
apps/api/src/database/schema/user.ts               (email y password_hash nullable — D-5)
apps/api/src/modules/core/core.module.ts           (importar ClientesModule)
apps/api/src/app.module.ts                         (APP_INTERCEPTOR: TenantContextInterceptor)
apps/api/src/common/interceptors/tenant-context.interceptor.ts (tenant = x-tenant-id validado vs JWT — R40)
apps/api/src/modules/core/auth/auth.service.ts     (401 si password_hash IS NULL o email vacío — R9, R11)
apps/api/src/modules/core/auth/roles.guard.ts      (usar el tenant resuelto, no el header crudo)
apps/api/src/modules/core/__tests__/routes-surface.test.ts (RUTAS_PERMITIDAS +23)
tests/migrations.test.ts                           (TABLAS_PERMITIDAS +6)
apps/api/test/db/migrations.db.test.ts             (verificar tablas + RLS + columnas nullable)
apps/api/drizzle/meta/_journal.json                (entrada 5)
packages/types/src/index.ts                        (reexportar clientes)
specs/auth_rbac/requirements.md                    (nota de enmienda: R1 superado por R10 — §7.2)
feature_list.json                                  (#5 → spec_ready)
```

---

## 14. Estado de las ambigüedades

Las 7 preguntas abiertas de la v1 están **resueltas por el humano** y
registradas como D-1 … D-7 en la tabla final de `requirements.md`. No queda
ninguna decisión de producto pendiente para implementar #5. Las dos
consecuencias que conviene tener presentes al revisar son §7.3 (identidad
duplicada posible sin email) y §10 (RF-C5 parcialmente cubierto).
