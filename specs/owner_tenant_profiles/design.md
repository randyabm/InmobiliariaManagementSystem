# Design — owner_tenant_profiles

> Feature #5. Hoja de vida de propietario e inquilino — **núcleo**.
> Este documento asume `docs/architecture.md` y `docs/conventions.md`; solo
> documenta los puntos donde la feature roza sus fronteras.
> **v3 — la feature se partió en dos.** Tarifa de retención, codeudores y
> referencias se especifican en `specs/retencion_codeudor_referencias/` (#25).

---

## 1. Encaje con lo que ya existe

Esta feature es la **primera con endpoints de negocio reales**. Se apoya en lo
ya construido y **no** propone un diseño paralelo:

| Ya existe (feature) | Cómo se reutiliza aquí |
|---|---|
| `tenant` + RLS por `app.current_tenant` (#2) | Las tres tablas nuevas llevan `tenant_id` y la misma política RLS, con `FORCE`. |
| `user` + `user_role` + JWT + `RolesGuard` + `@Roles` (#3) | La identidad del propietario/inquilino es un `user`; su relación con la inmobiliaria es un `user_role` (`rol` = `propietario` / `inquilino`). Los endpoints usan `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles('admin','empleado')`. |
| `audit_log` append-only + `AuditService` + `@Audit` (#4) | Las mutaciones de perfil y de cuenta bancaria se auditan con el decorador existente; no se crea otro mecanismo. |
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
   → 403 (**R33**).
3. **`user.email` y `user.password_hash` se relajan a NULL-able** (**D-5**,
   R6–R8). Esto modifica el esquema de la feature #3, ya cerrada: §7.2.
4. **`AuthService` consulta con el pool crudo**, sin `SET LOCAL`. No se
   refactoriza (el login es pre-tenant por naturaleza), pero sí se corrige su
   lógica por D-5/R8. **Los repositorios nuevos no pueden usar el pool**: usan
   el cliente de la transacción (§3, **R34**).

Estos cuatro puntos son **infraestructura compartida**: la feature #25 los da
por hechos y no los vuelve a tocar.

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

Estructura que crea esta feature (convención de `docs/conventions.md`):

```
modules/core/clientes/
├── clientes.module.ts
├── propietarios.{controller,service,repository}.ts
├── inquilinos.{controller,service,repository}.ts
├── cuentas-bancarias.{controller,service,repository}.ts
├── identidad.service.ts          # crear-o-vincular user + user_role
├── dto/                          # esquemas zod (zod ya es dependencia)
├── errors/
└── __tests__/
```

La feature #25 **extiende** este mismo módulo (añade `retencion.*`,
`codeudores.*` y `referencias.*`); no crea un módulo paralelo.

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
(`docs/architecture.md`, **R34**).

Los repositorios son el único lugar con SQL. Se usa SQL parametrizado sobre
`PoolClient` (no `drizzle(pool)`), porque Drizzle sobre el pool abriría una
conexión distinta de la que tiene el `SET LOCAL`. Los esquemas Drizzle se
mantienen como **fuente declarativa del esquema** (`database/schema/`), igual
que en #2–#4.

---

## 4. Migración `0005_owner_tenant_profiles.sql`

Forward-only e idempotente. **Sí habilita RLS** (`ENABLE` + `FORCE` + política
por `tenant_id`) en las tres tablas nuevas, en la misma migración que las crea
(**R5**, `docs/conventions.md`).

Contenido:

1. `ALTER TABLE "user" ALTER COLUMN "password_hash" DROP NOT NULL;`
   — un cliente (RF-C1) se registra sin credenciales. Contrapartida obligatoria:
   **R6** (login 401 si `password_hash IS NULL`).
2. `ALTER TABLE "user" ALTER COLUMN "email" DROP NOT NULL;` (**D-5**)
   — la restricción `UNIQUE` existente **se conserva sin cambios**: en
   PostgreSQL `UNIQUE` trata cada NULL como distinto, así que varios usuarios
   sin email conviven y dos emails iguales no nulos siguen colisionando
   (**R7**). No se necesita índice parcial. Contrapartida obligatoria: **R8**.
3. `CREATE TABLE IF NOT EXISTS perfil_propietario (...)` — campos de **R1**,
   con `sujeto_retencion` y **sin** columna de tarifa (**D-2**).
4. `CREATE TABLE IF NOT EXISTS perfil_inquilino (...)` — campos de **R2**.
5. `CREATE TABLE IF NOT EXISTS cuenta_bancaria (...)` — campos de **R3**.
6. RLS en las tres: `ENABLE`, `FORCE` y política
   `USING (tenant_id = current_setting('app.current_tenant', true)::uuid)`, con
   el mismo patrón `DO $$ IF NOT EXISTS (SELECT 1 FROM pg_policies ...)` de
   `0003`/`0004`.
7. Índice único parcial (**R4**):
   ```sql
   CREATE UNIQUE INDEX IF NOT EXISTS cuenta_bancaria_predeterminada_key
     ON cuenta_bancaria (perfil_propietario_id)
     WHERE es_predeterminada AND activa;
   ```
8. Índices de consulta: `perfil_propietario (tenant_id, documento)`,
   `perfil_inquilino (tenant_id, documento)`,
   `cuenta_bancaria (tenant_id, perfil_propietario_id)`.
9. Entrada nueva en `apps/api/drizzle/meta/_journal.json`.

Todas las fechas `timestamptz` (`docs/conventions.md`). Esta feature no
introduce ninguna columna monetaria ni porcentual.

---

## 5. Superficie HTTP (13 rutas)

Todos los endpoints: `@UseGuards(JwtAuthGuard, RolesGuard)` +
`@Roles('admin','empleado')` (**R32**). Validación de entrada con zod en el
borde. Rutas en kebab-case y plural.

| Método y ruta | Servicio | Requirements | Auditoría |
|---|---|---|---|
| `POST /propietarios` | `PropietariosService.crear` | R10, R16, R22, R24, R25, R26 | `@Audit('crear','perfil_propietario')` |
| `GET /propietarios` (`?tipo_documento&documento`) | `.buscar` | R23, R31 | — |
| `GET /propietarios/:id` | `.obtener` | R12, R31 | — |
| `PATCH /propietarios/:id` | `.actualizar` | R13, R16, R31 | `@Audit('actualizar','perfil_propietario')` |
| `DELETE /propietarios/:id` | `.darDeBaja` | R14, R31 | `@Audit('baja','perfil_propietario')` |
| `POST /propietarios/:id/cuentas-bancarias` | `CuentasBancariasService.crear` | R11, R31 | `@Audit('crear','cuenta_bancaria')` |
| `GET /propietarios/:id/cuentas-bancarias` | `.listar` | R12, R31 | — |
| `PATCH /propietarios/:idPropietario/cuentas-bancarias/:idCuenta` | `.actualizar` | R15, R31 | `@Audit('actualizar','cuenta_bancaria')` |
| `POST /inquilinos` | `InquilinosService.crear` | R18, R19, R22, R24, R25 | `@Audit('crear','perfil_inquilino')` |
| `GET /inquilinos` (`?tipo_documento&documento`) | `.buscar` | R23, R31 | — |
| `GET /inquilinos/:id` | `.obtener` | R31 | — |
| `PATCH /inquilinos/:id` | `.actualizar` | R20, R31 | `@Audit('actualizar','perfil_inquilino')` |
| `DELETE /inquilinos/:id` | `.darDeBaja` | R21, R31 | `@Audit('baja','perfil_inquilino')` |

`RUTAS_PERMITIDAS` en
`apps/api/src/modules/core/__tests__/routes-surface.test.ts` se amplía con
estas **13** rutas (**R37**). Las 10 rutas de #25 se añadirán en su propia
corrida.

### Firmas nuevas relevantes

```ts
// identidad.service.ts — RF-C6 / R22 / R25 / R26
crearOVincularIdentidad(
  cliente: PoolClient,
  datos: { nombre: string; email?: string | null; telefono?: string },
  tenantId: string,
  rol: 'propietario' | 'inquilino',
): Promise<{ userId: string; reutilizada: boolean }>;
// Vincula SOLO por email no nulo. Sin email → identidad nueva (R26).

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
```

`crearOVincularIdentidad` recibe el `PoolClient` explícitamente para que la
identidad, el rol y el perfil ocurran en **la misma transacción** (**R22**).

Tipos compartidos con el frontend (`TipoDocumento`, `MedioPreferidoContacto`,
`PerfilPropietario`, `PerfilInquilino`, `CuentaBancaria`) van a
`packages/types/src/clientes.ts` (`docs/conventions.md`), no se duplican en la
app web. #25 añadirá sus tipos al mismo archivo.

---

## 6. El override de cuenta bancaria sin la entidad Propiedad (decisión clave)

El criterio de aceptación "la cuenta bancaria del propietario puede
sobrescribirse a nivel de propiedad" depende de `Propiedad`, que es la
**feature #6** y no existe. El PRD ya dice **dónde** vive el override: RF-P1,
grupo *Contable* — "cuenta bancaria destino del canon (por defecto la del
propietario, con override por propiedad)" — y §13.4: "`BankAccount` asociada
por defecto al propietario y sobrescribible por propiedad".

**Decisión.** Esta feature entrega:

1. La cuenta **por defecto a nivel de propietario** (`cuenta_bancaria` +
   índice único parcial de una sola predeterminada, R3/R4/R11/R15).
2. La **regla de precedencia** como código propio y probado:
   `resolverCuentaDeGiro(perfilPropietarioId, cuentaOverrideId)` — el override
   gana; si no hay, la predeterminada; si no hay ninguna o el override es
   ajeno, error (R27–R30).
3. La validación de pertenencia (`mismo propietario` + `mismo tenant`) para que
   #6 no pueda enchufar una cuenta ajena (R29).

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

**Tercera alternativa descartada (D-2):** dejar la tarifa de retención
(`porcentaje_retencion`) en el perfil del propietario, como proponía la v1 de
este spec. El humano lo vetó: la tarifa la fija la ley y cambia por año, así
que una copia por propietario se desincroniza en silencio y produce cálculos de
giro incorrectos. En #5 solo queda la marca booleana `sujeto_retencion` (R16), y
**#5 no calcula retención** (R17).

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
  Queda **superado por R7 de esta feature**. El `implementer` debe añadir una
  nota de enmienda en `specs/auth_rbac/requirements.md` (igual que
  `docs/conventions.md` fue enmendado tras la feature #1) para que el estado del
  repositorio no quede contradictorio. Es la task T17.
- `AuthService.login` debe rechazar 401 cuando el email recibido es nulo o
  vacío, sin que la consulta pueda casar `email IS NULL` (**R8**), y cuando
  `password_hash IS NULL` (**R6**).
- El payload JWT (`specs/auth_rbac` R4) incluye `email`. Para clientes sin email
  no se emite token en esta feature (no hay portal todavía: RF-AU2/AU4 son
  features posteriores), así que el payload no cambia. **Queda anotado como
  dependencia** para la feature del portal del cliente: tendrá que decidir el
  identificador del token de un usuario sin email.
- `audit_log.actor_email` ya es NULL-able, así que la auditoría no requiere
  cambios.

### 7.3 Clave de identidad sin email (D-5, R9)

Un propietario sin email se identifica por
(`tenant_id`, `tipo_documento`, `documento`) de su perfil. **Consecuencia
asumida:** al no poder buscar por documento fuera del tenant (**R26**, §11.3),
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

- `ResourceNotFoundError` (404) — perfil o cuenta inexistente **o de otro
  tenant** (**R31**). No se crea un error distinto para el caso cross-tenant: la
  respuesta debe ser indistinguible.

Nuevos, en `modules/core/clientes/errors/` heredando de `AppError`:

| Error | `code` | HTTP | Cuándo |
|---|---|---|---|
| `PerfilYaExisteError` | `PERFIL_YA_EXISTE` | 409 | R24 — documento ya con perfil en el tenant |
| `CuentaDeGiroInvalidaError` | `CUENTA_DE_GIRO_INVALIDA` | 400 | R29, R30 — override ajeno o sin cuenta resoluble |
| `SinContextoDeTenantError` | `SIN_CONTEXTO_DE_TENANT` | 500 | R34 — repositorio invocado sin `tenantClient` (defecto de programación, no condición esperada) |

`AllExceptionsFilter` ya traduce `AppError` (mensaje propio si `status < 500`),
así que no se toca. `SinContextoDeTenantError` cae en el 500 genérico a
propósito: no debe filtrar detalle al cliente. La feature #25 reutiliza
`SinContextoDeTenantError` y `ResourceNotFoundError`, y añade el suyo propio.

---

## 9. Frontera con la feature #25 (qué NO se hace aquí)

`sujeto_retencion` **existe como columna del perfil y se lee y escribe en #5**
(R1, R16), pero su **consumo** llega en #25:

- #5 **no** crea `tarifa_retencion`, ni endpoints de `/configuracion/retencion`,
  ni `resolverPorcentaje`. **#5 no calcula retención** (R17).
- #5 **no** crea `codeudor_inquilino` ni `referencia_inquilino` ni sus rutas
  (D-6 se implementa entera en #25).
- #25 da por hechos: el helper `obtenerClienteTenant`, el
  `TenantContextInterceptor` registrado, `perfil_propietario` (para leer
  `sujeto_retencion`) y `perfil_inquilino` (FK de sus tablas). Es una
  **dependencia dura: #25 no puede implementarse antes de que #5 esté `done`.**

---

## 10. Cobertura parcial de RF-C5 y RF-C4 (huecos conocidos)

| Parte del PRD | Estado en #5 | Dónde se completa |
|---|---|---|
| RF-C5 datos personales / contacto | Cubierto (R1, R10, R12) | — |
| RF-C5 datos bancarios (defecto + override) | Cubiertos el defecto y la regla de override (R3, R11, R15, R27–R30) | #6 aporta `propiedad.cuenta_bancaria_id` (§6) |
| RF-C5 datos fiscales | Cubierta solo la marca `sujeto_retencion` (R16) | **Tarifa: feature #25.** **Certificados: módulo contable (D-3).** |
| RF-C5 lista de propiedades y su estado | **No cubierto a propósito (D-1)**; R12 prohíbe exponer el campo | **Feature #6** |
| RF-C4 campos mínimos del inquilino | Cubierto (R2, R18, R19) | — |
| RF-C4 codeudor/coarrendatario y referencias (opcionales) | **No cubierto en #5 (D-6)** | **Feature #25** |

**Instrucción para el `reviewer`:** al cerrar #5, RF-C5 y RF-C4 **no** deben
marcarse como completamente cubiertos. Las casillas restantes se cierran en #6,
#25 y el módulo contable.

---

## 11. Seguridad y datos personales

- **Aislamiento:** RLS `FORCE` en las tres tablas + repositorios que solo usan
  el cliente con `SET LOCAL`. El test de aislamiento se hace contra PostgreSQL
  real (Testcontainers) con un rol sin `BYPASSRLS`, como en
  `audit-log.test.ts`.
- **RBAC:** `@Roles('admin','empleado')` en las 13 rutas. El test de rechazo por
  rol es determinista (comparación de códigos 401/403, sin juicio de modelo).
- **Auditoría:** `@Audit(...)` en las 8 mutaciones. `metadata` solo lleva
  identificadores y nombres de campo modificados — **jamás** valores de
  `documento`, `celular`, `telefono`, `email` ni `numero_cuenta` (**R36**).
- **`numero_cuenta`** se guarda en columna `text` en claro; el cifrado en reposo
  se resuelve a nivel de almacenamiento (NFR §7), no por columna. No se registra
  en logs ni en auditoría, y solo lo devuelven los endpoints de
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
apps/api/src/common/database/cliente-tenant.ts
apps/api/src/modules/core/clientes/clientes.module.ts
apps/api/src/modules/core/clientes/identidad.service.ts
apps/api/src/modules/core/clientes/propietarios.{controller,service,repository}.ts
apps/api/src/modules/core/clientes/inquilinos.{controller,service,repository}.ts
apps/api/src/modules/core/clientes/cuentas-bancarias.{controller,service,repository}.ts
apps/api/src/modules/core/clientes/dto/*.ts
apps/api/src/modules/core/clientes/errors/*.ts
apps/api/src/modules/core/clientes/__tests__/*.test.ts
apps/api/src/database/__tests__/clientes-rls.test.ts
packages/types/src/clientes.ts
```

### Se modifican

```
apps/api/src/database/schema/index.ts              (exportar los 3 esquemas)
apps/api/src/database/schema/user.ts               (email y password_hash nullable — D-5)
apps/api/src/modules/core/core.module.ts           (importar ClientesModule)
apps/api/src/app.module.ts                         (APP_INTERCEPTOR: TenantContextInterceptor)
apps/api/src/common/interceptors/tenant-context.interceptor.ts (tenant = x-tenant-id validado vs JWT — R33)
apps/api/src/modules/core/auth/auth.service.ts     (401 si password_hash IS NULL o email vacío — R6, R8)
apps/api/src/modules/core/auth/roles.guard.ts      (usar el tenant resuelto, no el header crudo)
apps/api/src/modules/core/__tests__/routes-surface.test.ts (RUTAS_PERMITIDAS +13)
tests/migrations.test.ts                           (TABLAS_PERMITIDAS +3)
apps/api/test/db/migrations.db.test.ts             (verificar tablas + RLS + columnas nullable)
apps/api/drizzle/meta/_journal.json                (entrada 5)
packages/types/src/index.ts                        (reexportar clientes)
specs/auth_rbac/requirements.md                    (nota de enmienda: R1 superado por R7 — §7.2)
feature_list.json                                  (#5 → spec_ready)
```

---

## 14. Estado de las ambigüedades (v3)

Las 7 preguntas abiertas de la v1 están **resueltas por el humano** y
registradas como D-1 … D-7 en la tabla final de `requirements.md`. Las dos
consecuencias que conviene tener presentes al revisar son §7.3 (identidad
duplicada posible sin email) y §10 (RF-C5 y RF-C4 parcialmente cubiertos).
Tras la revisión hay **cuatro preguntas nuevas** (PA-8 … PA-11): §18.

---

# v4 — Diseño de la corrección tras la revisión (B1–B4)

## 15. Por qué esta deuda se absorbe en #5 y no en una feature aparte

**Decisión del humano (2026-07-27).** El `reviewer` ofrecía la alternativa de
diferir B3 a una feature propia
(`progress/review_owner_tenant_profiles.md` §10.4). Se descarta. Razones que
quedan escritas para que nadie las tenga que reconstruir:

1. **Dos de los cuatro hallazgos son de código propio de #5 o alcanzables desde
   sus rutas.** B1 es una vulnerabilidad viva en `propietarios.repository.ts` e
   `inquilinos.repository.ts`, ambos escritos por esta feature. No es deuda
   heredada: es un defecto nuevo.
2. **Los otros dos no se pueden separar de B1 sin dejar el arreglo a medias.**
   La corrección de B1 en el código de aplicación (R38) es exactamente la regla
   que B4 debe escribir en el motor (R50). Arreglar solo una capa reproduce la
   causa del defecto: una única barrera que la siguiente feature puede olvidar.
3. **§C7 se comprueba en *cada* feature, no solo en la que introduce el
   invariante** (`CHECKPOINTS.md` §C7, `AGENTS.md` §3). Con aislamiento y
   auditoría en rojo, ninguna feature posterior podría cerrarse tampoco: diferir
   solo mueve el bloqueo.
4. **Diferir B3 exigía dejar constancia de que el aislamiento es "defensa en
   papel"** hasta que llegase esa feature. Eso convierte cada feature intermedia
   en una entrega sobre un invariante que se sabe incumplido — precisamente lo
   que llevó a revertir #2, #3 y #4 (§17).

**Consecuencia de alcance:** #5 pasa de 37 requirements / 47 tasks a **58 / 68**,
y su diff incluye cambios en migraciones de #3 y #4, en `init.sh`,
`docker-compose.yml` y `.env.example`. Es un ensanchamiento consciente del
alcance de una feature en curso, aprobado por el humano, no un descuido de
frontera.

## 16. B3 + B4: orden que nunca deja el login roto

> ⚠️ **Reescrito por D-8 y D-9 → ver §20.5 para el orden vigente.** Lo que sigue
> es el razonamiento original (B1–B4 antes de las decisiones del humano); se
> conserva porque el *criterio* —el login nunca puede quedar roto entre dos
> tasks, y el conmutador de rol va el último— no ha cambiado, solo la lista de
> pasos.

El riesgo del corte está en que **la corrección de B3 activa el defecto de B4**:
mientras la app sea superusuario, la política rota de `user` es inofensiva; en
cuanto deje de serlo, `POST /auth/login` devuelve 401 a todo el mundo y crear
identidades es imposible. El orden es, por tanto, parte del diseño y no una
preferencia de estilo:

```
  (0) puerta          T48–T49   test:db en init.sh + guard anti-DDL en tests
  (1) B1              T50–T52   filtro de exclusividad + 409 + test HTTP
  (2) B2              T53       migración de triggers append-only
  (3) B4 esquema      T54–T56   políticas por comando + funciones acotadas
  (4) B4 aplicación   T57–T59   login e identidad pasan por las funciones
  (5) B3 rol          T60–T64   rol sin BYPASSRLS, GRANTs, fail-fast, entorno
  (6) re-verificación T65–T68   §C7 con el rol real
```

Lo que hace segura la secuencia:

- **(3) y (4) se hacen mientras la app sigue siendo superusuario.** Las políticas
  nuevas y las funciones `SECURITY DEFINER` son inertes para un superusuario, así
  que la suite sigue verde tras cada task y el repositorio nunca queda en un
  estado con el login roto.
- **(5) es el único conmutador.** Cuando se cambia `DATABASE_URL` al rol de
  aplicación, todo lo que ese cambio activa ya está escrito y probado.
- **La inversa —(5) antes de (3)/(4)— rompe el login entre dos tasks**, que es
  justo lo que hay que evitar.
- **(0) va primero a propósito:** sin `test:db` en la puerta, ninguna de las
  aserciones de RLS y de forma de migración de los pasos siguientes entra en el
  semáforo, que es la causa de fondo de todo este episodio.

### B1 — filtro de exclusividad (R38, R39)

La condición correcta **no** es "la identidad tiene rol en mi tenant" (el paso 1
del ataque crea ese rol), sino que no lo tenga en ningún otro:

```sql
UPDATE "user" SET nombre = $1, email = $2, telefono = $3, updated_at = now()
 WHERE id = $4
   AND NOT EXISTS (
     SELECT 1 FROM user_role ur
      WHERE ur.user_id = "user".id
        AND ur.tenant_id <> $5
   );
```

El repositorio devuelve el número de filas afectadas; si es 0 habiendo campos de
contacto que cambiar, el servicio lanza `IdentidadCompartidaNoEditableError`
(409). El mismo predicado se escribe como `USING`/`WITH CHECK` de la política de
`UPDATE` sobre `user` (R50): dos capas, la misma regla.

### B4 — política de `user` y ruta de identidad acotada

`user` es una tabla de **identidad global**: no tiene `tenant_id`, así que una
política pensada para tablas con `tenant_id` nunca iba a encajar. El diseño
mínimo que satisface R6, R8, R22 y R25 sin ampliar visibilidad:

| Comando | Política | Motivo |
|---|---|---|
| `SELECT` | `USING (id IN (SELECT user_id FROM user_role WHERE tenant_id = current_setting(...) AND activo))` | Mantiene la visibilidad actual: un tenant ve las identidades que tiene vinculadas, nada más. |
| `INSERT` | `WITH CHECK (true)` | Crear identidad es global y no revela nada. Rompe el bloqueo circular de R22. |
| `UPDATE` | `USING` + `WITH CHECK` con el predicado de exclusividad de R38 | Defensa en profundidad de B1 (R50). |
| `DELETE` | **sin política** → denegado | La identidad no se borra (`docs/conventions.md`). |

Las dos operaciones que ocurren **antes** de que exista contexto de tenant no
pueden pasar por esas políticas, así que se resuelven con dos funciones
`SECURITY DEFINER` de superficie mínima, propiedad del rol de migración y con
`EXECUTE` concedido solo al rol de aplicación (R52):

```sql
identidad_buscar_por_email(p_email text) RETURNS uuid
-- Coincidencia EXACTA. Devuelve solo el id. Para la vinculación de R25/R53.

identidad_credenciales_por_email(p_email text)
  RETURNS TABLE (id uuid, nombre text, email text, password_hash text)
-- Coincidencia EXACTA. Solo lo que necesita el login (R51).
```

Ninguna acepta patrones ni devuelve listados: no habilitan enumeración más allá
de lo que ya permite cualquier formulario de login. **Residuo conocido:**
`identidad_buscar_por_email` permite a un tenant confirmar que un email existe en
el sistema. No es un descuido, es el precio de RF-AU6, y es exactamente lo que se
pregunta en **PA-9**.

### B3 — rol de aplicación y provisión

- **Rol:** `NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE LOGIN`, **no dueño**
  de ninguna tabla (R43).
- **GRANTs mínimos (R45):** `USAGE` en el esquema; `SELECT, INSERT, UPDATE` en
  las tablas de negocio; `SELECT, INSERT` en `audit_log`; `EXECUTE` en las dos
  funciones de identidad. **Ningún `DELETE` en ninguna tabla** — las bajas son
  lógicas, así que negarlo en el motor convierte la convención en barrera.
- **Provisión (R46):** un único procedimiento
  `asegurarRolDeAplicacion(urlDeMigracion, { usuario, clave })` en
  `apps/api/src/database/rol-aplicacion.ts`, idempotente, que se ejecuta
  **después** de las migraciones (los `GRANT` no alcanzan a tablas que aún no
  existían) y que usan por igual `db:migrate`, `init.sh`, la CI y los entornos de
  prueba. Que producción y tests usen **el mismo código** es lo que evita repetir
  el defecto de B2, donde el test se fabricaba su propio sujeto.
- **Credenciales (R47):** `DATABASE_MIGRATION_URL` (rol privilegiado, solo
  migraciones y provisión) y `DATABASE_URL` (rol de aplicación). Sujeto a
  **PA-11**.
- **Fail-fast (R44):** al arrancar, la app consulta
  `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user` y
  aborta con `ConfigurationError` si alguno es `true`. Es la única forma de que
  una regresión de despliegue —volver a poner la cadena del superusuario— falle
  ruidosamente en vez de desactivar el RLS en silencio.

### B2 — triggers de auditoría

La migración nueva crea `audit_log_prevent_mutation()` y los dos triggers
`BEFORE UPDATE` / `BEFORE DELETE`, exactamente los que hoy fabrica el test
(`audit-log.test.ts:30-52`). El `beforeAll` de ese test deja de crearlos: si la
migración no los instala, el test **falla**, que es lo que debía ocurrir desde
#4. El trigger protege incluso al rol dueño (R41), cosa que ninguna política RLS
puede hacer.

## 17. Contradicciones y estado del repositorio

- **#2, #3 y #4 han sido revertidas a `in_progress`** en `feature_list.json` por
  el humano. Estaban `done` sobre invariantes que no se cumplían en ejecución: el
  RLS de #2 es inerte con el rol actual (B3), la política de `user` de #3
  contradice el modelo de identidad (B4) y la inmutabilidad de #4 no existe en el
  producto (B2). **Se cierran cuando #5 las demuestre con el rol real** (R58);
  los tests que las cierran son T65 y T66, y viven en #5.
- **La cabecera de `0004_auditoria.sql` no se edita** (R42), pese a que el
  reviewer pedía corregirla in situ. `docs/conventions.md` prohíbe editar una
  migración aplicada, y el migrador de Drizzle la identifica por hash: cambiar un
  comentario la convierte en otra migración para el runner. La corrección va en
  la cabecera de la migración nueva, que declara qué faltaba. **Es una desviación
  consciente de la instrucción literal del reviewer, por una razón técnica;
  queda escrita aquí para que él la valide o la rebata.**
- **R1 ("los datos de contacto no se duplican") queda en tensión con PA-8(a).**
  Si el humano elige copiar el contacto al perfil, R1 tendrá que enmendarse. Con
  la opción mínima provisional (409) R1 sigue intacto.
- **`AuthService` sigue siendo el único punto que consulta fuera de una
  transacción con contexto de tenant**, ahora a través de una función acotada. Es
  una excepción deliberada y documentada a la regla de §3, no un olvido: el login
  es previo al tenant por naturaleza.
- **Deuda registrada por el reviewer que NO entra en esta ampliación:** O2
  (fallback al header crudo en `audit.interceptor.ts`), O3 (`actor_email` en cada
  entrada de auditoría), O4 (`AuditService.log` se traga los errores), O5 (los
  tests de `src/**` levantan Docker pese al comentario de `vitest.config.ts`) y
  O6 (`getProfile` tipa `email: string`). El humano no las incluyó en el encargo;
  siguen abiertas y conviene decidir sobre O4 y O5 antes de la siguiente feature.

## 18. Preguntas abiertas de la v4

Están al final de `requirements.md`: **PA-8** (propiedad de los datos de contacto
de una identidad compartida), **PA-9** (qué ve un tenant de una identidad ajena),
**PA-10** (vinculación sin consentimiento) y **PA-11** (gestión de la credencial
del rol de aplicación).

**PA-9 y PA-10 bloquean la política definitiva de `user`.** Lo especificado aquí
es la opción mínima que no amplía visibilidad respecto de lo que ya hace el
sistema; si el humano elige (b) o (c) de PA-9, cambian R52, R53 y el diseño de
las funciones de identidad, y R25 tendría que enmendarse.

## 19. Archivos que toca la ampliación

### Se crean

```
apps/api/drizzle/0006_auditoria_append_only.sql          (B2 — R40, R41, R42)
apps/api/drizzle/0007_politica_identidad.sql             (B4 — R49, R50, R52)
apps/api/src/database/rol-aplicacion.ts                  (B3 — R46)
apps/api/src/database/__tests__/identidad-rls.test.ts    (B4 — R49–R55)
apps/api/src/database/__tests__/rol-aplicacion.test.ts   (B3 — R43–R45)
apps/api/src/modules/core/clientes/errors/identidad-compartida-no-editable.error.ts
tests/ddl-en-tests.test.ts                               (R57 — guard anti-DDL)
```

### Se modifican

```
init.sh                                            (run_script test:db — R56; provisión del rol)
docker-compose.yml, .env.example                   (APP_DB_USER/APP_DB_PASSWORD, DATABASE_MIGRATION_URL — R47)
apps/api/src/config/app-config.ts                  (variables nuevas + fail-fast — R44, R47)
apps/api/src/database/migrate.ts                   (usa DATABASE_MIGRATION_URL y provisiona el rol — R46)
apps/api/src/modules/core/auth/auth.service.ts     (login por función acotada — R51, R52)
apps/api/src/modules/core/clientes/identidad.service.ts (vinculación por función acotada + auditoría — R53, R54)
apps/api/src/modules/core/clientes/propietarios.repository.ts (UPDATE con exclusividad — R38)
apps/api/src/modules/core/clientes/inquilinos.repository.ts   (idem — R38)
apps/api/src/modules/core/clientes/{propietarios,inquilinos}.service.ts (409 — R39)
apps/api/test/support/entorno-clientes.ts          (la app corre con el rol de aplicación — R48)
apps/api/src/database/__tests__/audit-log.test.ts  (deja de crear el trigger — R40, R57)
apps/api/src/database/__tests__/clientes-rls.test.ts (usa el rol provisionado, no uno ad hoc — R57)
apps/api/test/db/migrations.db.test.ts             (triggers, políticas nuevas, GRANTs)
apps/api/drizzle/meta/_journal.json                (entradas 6 y 7)
```


---

## 20. D-8 … D-11: diseño tras las decisiones del humano

Las cuatro preguntas abiertas de la v4 (PA-8 … PA-11) están resueltas. El efecto
neto es que **la corrección encoge**: B2 quedó cerrado, y B1 y B4 pierden la
mayor parte de su complejidad porque desaparece el concepto que la causaba —la
identidad compartida entre inmobiliarias—.

### 20.1 D-8: `user` deja de ser global y pasa a ser una tabla por tenant

El defecto de fondo de B4 no era la política: era que `user` **no tenía
`tenant_id`** y se le había puesto una política diseñada para tablas que sí lo
tienen. Con D-8 esa contradicción desaparece de raíz.

| Antes (v3/v4) | Después (D-8) |
|---|---|
| `user` global, sin `tenant_id` | `user.tenant_id NOT NULL` → tabla de negocio como las demás |
| `UNIQUE(email)` global | `UNIQUE (tenant_id, email)`; los NULL siguen conviviendo (D-5) |
| Política `FOR ALL` con subconsulta a `user_role`, sin `WITH CHECK` | Política estándar del proyecto: `tenant_id = current_setting('app.current_tenant', true)::uuid` en `USING` **y** en `WITH CHECK` |
| Bloqueo circular al insertar (`WITH CHECK` exigía un `user_role` que aún no podía existir) | El `INSERT` lleva el `tenant_id` de la petición y pasa el `WITH CHECK` |
| Dos funciones `SECURITY DEFINER` sobre `user` (login + vinculación por email) | **Una** función, y no sobre `user`: `tenant_por_nit(text) RETURNS uuid` |
| Predicado de exclusividad en el `UPDATE` (R38 + R50) | `AND tenant_id = $tenant`, la misma condición que el resto de repositorios |

La coherencia entre identidad y rol se fuerza en el motor con `UNIQUE (id,
tenant_id)` en `user` y una **FK compuesta** `(user_id, tenant_id)` desde
`user_role` (**R60**): así es imposible que un rol apunte a un tenant distinto
del de su identidad, que es la forma en que este modelo podría degradarse en
silencio con el tiempo.

**Migración de datos (R61).** `user.tenant_id` se rellena desde `user_role`. Si
alguna identidad tuviera roles activos en más de un tenant, la migración
**aborta** con un mensaje accionable en vez de elegir: repartir personas entre
inmobiliarias sin traza es peor que parar. Hoy solo existe un caso así y es una
semilla de test (`entorno-clientes.ts`), que T54 adapta.

### 20.2 D-8: el login necesita saber en qué inmobiliaria entra

Es la consecuencia menos obvia de D-8 y la que **toca la feature #3, ya
construida**. Si el correo deja de ser único global, `POST /auth/login` con
`{email, password}` es ambiguo: puede haber dos personas distintas con el mismo
correo en dos inmobiliarias.

**Diseño (R63, R66, y D-12):** el login pasa a exigir el **`codigo`** de la
inmobiliaria —columna nueva en `tenant`, ver §20.7— y resuelve así:

```
1. normalizar(codigo)                          (trim + minúsculas, R74)
2. tenant_por_codigo(codigo) → tenant_id       (SECURITY DEFINER, coincidencia exacta)
3. BEGIN; SET LOCAL app.current_tenant = tenant_id
4. SELECT … FROM "user" WHERE email = $1       (ya filtrado por RLS)
5. 401 uniforme si: el código no existe, no hay fila, password_hash NULL o clave incorrecta
   400 solo si el código falta o no cumple el formato
```

Dos propiedades que no son accidentales:

- **El login deja de ser la excepción.** Antes consultaba `user` con el pool
  crudo, fuera de toda transacción con contexto de tenant (`auth.service.ts:44`),
  que es exactamente lo que la revisión señaló en B4.3. Ahora corre bajo RLS como
  todo lo demás, y §3 ya no necesita tolerar una excepción.
- **El 401 es uniforme (R64).** Correo de otro tenant, código inexistente y
  clave incorrecta responden lo mismo. Si el código inexistente diera un error
  distinto, el login se convertiría en un oráculo para descubrir qué
  inmobiliarias son clientes del SaaS. El **400** se reserva para lo que es
  error de forma —falta el código o no cumple el formato—, que no revela nada.

### 20.3 D-9: el contacto se muda al perfil (delta, no rediseño)

Sobre el esquema **ya implementado** en T1–T47, el cambio es de tres columnas:

| Tabla | Se añade | Motivo |
|---|---|---|
| `perfil_propietario` | `email_contacto text NULL`, `telefono_contacto text NULL` | D-5 mantiene el correo opcional para el propietario |
| `perfil_inquilino` | `email_contacto text NOT NULL` | RF-C4 exige correo del inquilino; `celular` ya estaba y hace de teléfono |
| `user` | *(nada)* | Conserva `email` y `password_hash` como **credencial**; en un cliente recién registrado `email` queda **NULL** (R71) |

`user.telefono` **no se elimina**: lo siguen usando los usuarios internos que
crea la feature #3. Simplemente deja de ser el teléfono de contacto de un
cliente. Borrarlo sería un cambio destructivo sin necesidad.

**Origen del dato para notificar (R72).** El motor de notificaciones (RF-N1,
feature #10) toma el destinatario y el canal **del perfil**:
`email_contacto` / `celular` + `medio_preferido_contacto` (RF-C4). Nunca de
`user`, que puede tener el correo a NULL y en todo caso es la credencial de
acceso, no un canal de aviso. R72 lo convierte en un requisito verificable hoy,
antes de que #10 exista.

**Por qué D-9 mejora el modelo y no solo resuelve B1:** dos inmobiliarias pueden
tener datos de contacto distintos del mismo propietario —uno le da su correo
personal a una y el de su empresa a otra— y ninguna debe pisar los de la otra.
Con el contacto en `user` eso era imposible de representar.

### 20.4 Qué queda de RF-AU6 (y qué no)

RF-AU6 (PRD §10.3, línea 556) dice: *"Debe soportarse el caso de un inquilino
que tiene relación con **más de una inmobiliaria** (distintos tenants) — su
cuenta de identidad **puede** ser única, pero con acceso segmentado por tenant."*

| Parte de RF-AU6 | Estado con D-8 |
|---|---|
| Soportar que una persona se relacione con varias inmobiliarias | **Cubierto.** Nada lo impide: tendrá un perfil y una identidad en cada una. |
| Acceso **segmentado por tenant** | **Cubierto, y más fuerte que antes.** La segmentación ya no depende de filtrar roles en el token: la identidad misma pertenece a un solo tenant y el RLS la aísla. |
| Cuenta de identidad **única** | **No cubierto, a propósito.** El PRD dice "puede", no "debe". D-8 elige que no lo sea. |
| Consecuencia práctica | Esa persona tendrá **dos cuentas, dos contraseñas y dos portales**, y al entrar tendrá que indicar con qué inmobiliaria (su `codigo`). |

> **Aceptado explícitamente por el humano (D-13, 2026-07-27),** también para el
> **portal del inquilino** (RF-AU2/AU4), que es donde el coste se nota de
> verdad: el inquilino que arrienda con dos inmobiliarias mantendrá dos
> credenciales y entrará a dos portales distintos. No es un efecto colateral que
> se haya deslizado en el diseño: es la opción elegida, con su precio conocido.

La lectura estrecha, para que quede escrita sin ambigüedad: **RF-AU6 se cumple
en su parte de segmentación y se renuncia a su parte de cuenta única**, que el
propio PRD deja opcional.

También queda afectado **RF-C2** ("un mismo usuario puede tener múltiples
roles/relaciones"): sigue siendo cierto **dentro de un tenant** (una persona
puede ser propietaria e inquilina de la misma inmobiliaria, §7.4), pero deja de
serlo *entre* tenants. Es una lectura más estrecha del PRD que la de la v3, y es
la que el humano eligió.

### 20.5 Orden de ejecución vigente

```
hechas   T48 T49 T53        puerta (test:db + guard anti-DDL) y B2 cerrado
 1       T50 T51 T52        B1: escritura sobre `user` acotada al tenant
 2       T54 T55 T56        D-8 esquema: tenant_id, política estándar, tenant_por_nit
 3       T57 T58 T59        D-8 aplicación: login por (nit, email); identidad nunca heredada de otra inmobiliaria
 4       T69 T70 T71 T72    D-9: contacto al perfil
 5       T60 … T64          B3/D-10: rol sin BYPASSRLS (el conmutador)
 6       T65 … T68          re-verificación de §C7 con el rol real
```

El invariante de secuencia sigue siendo el mismo, con una condición nueva que
D-8 introduce:

- **Los pasos 2, 3 y 4 se hacen con la app todavía como superusuario.** Las
  políticas nuevas son inertes para él, así que la suite queda verde tras cada
  task.
- **El paso 3 va inmediatamente después del 2.** En cuanto la unicidad de correo
  es por tenant (T54), un login que busque solo por `email` podría resolver una
  fila ambigua. Entre T54 y T57 no hay correos repetidos —nadie los ha sembrado
  todavía—, así que el login sigue funcionando; **la regla operativa es no
  sembrar ningún correo duplicado hasta que T57 esté hecha**, y por eso el test
  que los crea (T59) va después.
- **El paso 4 va después del 3** para no mezclar dos cambios sobre la misma
  columna: en T57 el login deja de depender de `user.email` como identificador
  global, y solo entonces T70 la vacía en los clientes.
- **El paso 5 sigue siendo el único conmutador** y va el último de los cambios,
  igual que en la v4.

### 20.6 Efecto en otros specs

- **`specs/auth_rbac/` (feature #3, reabierta):** cambia el contrato de su R3
  (`POST /auth/login` ahora exige `nit`), su R4 (el JWT lleva un solo tenant) y
  su R1 (unicidad de correo por tenant, `tenant_id` en `user`). Queda registrada
  la **ENMIENDA 2** en su `requirements.md`, con el mismo rigor que la ENMIENDA
  de D-5.
- **`specs/retencion_codeudor_referencias/` (feature #25, `spec_ready`):** no
  cambia ningún requirement. Sus tablas cuelgan de `perfil_inquilino`, no de
  `user`, y sus codeudores y referencias **nunca fueron identidades** del
  sistema. Se le añade una nota de enmienda para que quien la implemente sepa
  que `perfil_inquilino` tiene ahora `email_contacto` y que no debe volver a
  introducir vinculación de identidades entre tenants.
- **Feature #6 y siguientes:** ninguna dependencia declarada en §6 cambia.

### 20.7 D-12: el código de inmobiliaria

El selector del login no es el NIT sino un **código corto legible**
(`arrendamientos-sion`). Decisión del humano; los motivos que dio:

1. **Legible para el usuario.** Escribir un NIT en un formulario de acceso es
   incómodo y propenso a error; un código con el nombre de la inmobiliaria se
   recuerda.
2. **No expone la lista de clientes del SaaS**, a diferencia de un desplegable
   de inmobiliarias.
3. **Sirve tal cual como subdominio** cuando llegue RF-INT2/RF-INT3 (fase 3-4):
   `arrendamientos-sion.portal.example.com`. El login no habrá que rehacerlo.

De (3) sale toda la validación (**R73**): el formato es el de una **etiqueta DNS
válida** —`^[a-z0-9]+(-[a-z0-9]+)*$`, de 3 a 63 caracteres—, que además cumple
por construcción la regla de `docs/conventions.md` de no usar tildes ni `ñ` en
identificadores. Y de ahí sale también la lista de **códigos reservados**
(**R75**): permitir `www` o `api` hoy garantiza una colisión el día del
despliegue de los subdominios. Es una salvaguarda técnica barata ahora y cara
después.

**Backfill (R76).** Los tenants existentes reciben su código derivado del
`nombre` de forma determinista (minúsculas, sin tildes, separadores a guiones,
recorte a 63) con sufijo numérico ante colisión. Determinista importa: el mismo
dato de partida produce el mismo código en desarrollo, en CI y en cualquier
entorno, así que ningún test depende del orden de inserción.

**Quién lo asigna (R77).** Hoy, quien da de alta la inmobiliaria, que es una
operación directa sobre la base: **no existe endpoint de alta de tenant**, y el
PRD describe el rol Super Admin (§3) pero no un `RF-*` de onboarding. El spec no
inventa ese flujo: se limita a exigir que el motor valide el código venga de
donde venga. Queda como **PA-14**, sin bloquear nada.

**Qué NO cambia el código.** El `nit` sigue en `tenant` (feature #2) como dato
fiscal de la inmobiliaria; simplemente deja de usarse como identificador de
acceso. Ningún requirement lo elimina.
