# Design — owner_tenant_profiles

> Feature #5. Hoja de vida de propietario e inquilino.
> Este documento asume `docs/architecture.md` y `docs/conventions.md`; solo
> documenta los puntos donde la feature roza sus fronteras.

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

### Deuda heredada que esta feature debe cerrar (no es diseño nuevo)

1. **`TenantContextInterceptor` no está registrado.** `grep` confirma que
   ninguna parte de `bootstrap.ts`/`app.module.ts` lo usa. Mientras no había
   endpoints de negocio era inocuo; con `/propietarios` sería un agujero de
   aislamiento. Se registra como `APP_INTERCEPTOR` en `AppModule`.
2. **El tenant se elegía como `user.roles[0].tenant_id`.** Con identidad
   multi-tenant (RF-AU6) eso es incorrecto: un usuario con roles en dos
   inmobiliarias acabaría escribiendo en la equivocada. Se cambia a: tenant =
   header `x-tenant-id`, validado contra los roles activos del JWT; si el JWT
   tiene exactamente un tenant y no hay header, se usa ese; cualquier otro caso
   → 403 (**R27**).
3. **`AuthService` consulta con el pool crudo**, sin `SET LOCAL`. No se
   refactoriza `AuthService` en esta feature (login es pre-tenant por
   naturaleza), pero **los repositorios nuevos no pueden hacerlo**: usan el
   cliente de la transacción (§3, **R28**).

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
├── propietarios.controller.ts
├── propietarios.service.ts
├── propietarios.repository.ts
├── inquilinos.controller.ts
├── inquilinos.service.ts
├── inquilinos.repository.ts
├── cuentas-bancarias.controller.ts
├── cuentas-bancarias.service.ts
├── cuentas-bancarias.repository.ts
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
(`docs/architecture.md`, **R28**).

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
   — un cliente (RF-C1) se registra sin credenciales. Cambio compatible hacia
   atrás (relaja, no restringe). Contrapartida obligatoria: **R6** (login
   rechaza 401 si `password_hash IS NULL`).
2. `CREATE TABLE IF NOT EXISTS perfil_propietario (...)` — campos de **R1**.
3. `CREATE TABLE IF NOT EXISTS perfil_inquilino (...)` — campos de **R2**.
4. `CREATE TABLE IF NOT EXISTS cuenta_bancaria (...)` — campos de **R3**.
5. RLS en las tres: `ENABLE`, `FORCE`, política
   `USING (tenant_id = current_setting('app.current_tenant', true)::uuid)`
   creada con el mismo patrón `DO $$ IF NOT EXISTS (SELECT 1 FROM pg_policies ...)`
   de `0003`/`0004`.
6. Índice único parcial (**R4**):
   ```sql
   CREATE UNIQUE INDEX IF NOT EXISTS cuenta_bancaria_predeterminada_key
     ON cuenta_bancaria (perfil_propietario_id)
     WHERE es_predeterminada AND activa;
   ```
7. Índices de consulta: `perfil_propietario (tenant_id, documento)`,
   `perfil_inquilino (tenant_id, documento)`,
   `cuenta_bancaria (tenant_id, perfil_propietario_id)`.
8. Entrada nueva en `apps/api/drizzle/meta/_journal.json`.

`porcentaje_retencion` es `numeric(5,2)` — nunca `float`
(`docs/conventions.md`, "Dinero y fechas"). Todas las fechas `timestamptz`.

---

## 5. Superficie HTTP

Todos los endpoints: `@UseGuards(JwtAuthGuard, RolesGuard)` +
`@Roles('admin','empleado')` (**R26**). Validación de entrada con zod en el
borde. Rutas en kebab-case y plural.

| Método y ruta | Servicio | Requirements | Auditoría |
|---|---|---|---|
| `POST /propietarios` | `PropietariosService.crear` | R7, R17, R19, R20 | `@Audit('crear','perfil_propietario')` |
| `GET /propietarios` (`?tipo_documento&documento`) | `.buscar` | R18, R25 | — |
| `GET /propietarios/:id` | `.obtener` | R9, R25 | — |
| `PATCH /propietarios/:id` | `.actualizar` | R10, R25 | `@Audit('actualizar','perfil_propietario')` |
| `DELETE /propietarios/:id` | `.darDeBaja` | R11, R25 | `@Audit('baja','perfil_propietario')` |
| `POST /propietarios/:id/cuentas-bancarias` | `CuentasBancariasService.crear` | R8, R25 | `@Audit('crear','cuenta_bancaria')` |
| `GET /propietarios/:id/cuentas-bancarias` | `.listar` | R9, R25 | — |
| `PATCH /propietarios/:idPropietario/cuentas-bancarias/:idCuenta` | `.actualizar` | R12, R25 | `@Audit('actualizar','cuenta_bancaria')` |
| `POST /inquilinos` | `InquilinosService.crear` | R13, R14, R17, R19, R20 | `@Audit('crear','perfil_inquilino')` |
| `GET /inquilinos` (`?tipo_documento&documento`) | `.buscar` | R18, R25 | — |
| `GET /inquilinos/:id` | `.obtener` | R25 | — |
| `PATCH /inquilinos/:id` | `.actualizar` | R15, R25 | `@Audit('actualizar','perfil_inquilino')` |
| `DELETE /inquilinos/:id` | `.darDeBaja` | R16, R25 | `@Audit('baja','perfil_inquilino')` |

`RUTAS_PERMITIDAS` en
`apps/api/src/modules/core/__tests__/routes-surface.test.ts` se amplía con las
13 rutas (**R31**).

### Firmas nuevas relevantes

```ts
// identidad.service.ts — RF-C6 / R17 / R20
crearOVincularIdentidad(
  cliente: PoolClient,
  datos: { nombre: string; email: string; telefono?: string },
  tenantId: string,
  rol: 'propietario' | 'inquilino',
): Promise<{ userId: string; reutilizada: boolean }>;

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
identidad, el rol y el perfil ocurran en **la misma transacción** (**R17**).

Tipos compartidos con el frontend (`TipoDocumento`, `MedioPreferidoContacto`,
`PerfilPropietario`, `PerfilInquilino`, `CuentaBancaria`) van a
`packages/types` (`docs/conventions.md`), no se duplican en la app web.

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
   índice único parcial de una sola predeterminada, R3/R4/R8/R12).
2. La **regla de precedencia** como código propio y probado:
   `resolverCuentaDeGiro(perfilPropietarioId, cuentaOverrideId)` — el override
   gana; si no hay, la predeterminada; si no hay ninguna o el override es
   ajeno, error (R21–R24).
3. La validación de pertenencia (`mismo propietario` + `mismo tenant`) para que
   #6 no pueda enchufar una cuenta ajena (R23).

Lo que #6 debe añadir (queda anotado como **dependencia explícita**):

- Columna `propiedad.cuenta_bancaria_id uuid NULL REFERENCES cuenta_bancaria(id)`
  en la migración de #6.
- Llamada `resolverCuentaDeGiro(propiedad.perfil_propietario_id, propiedad.cuenta_bancaria_id)`
  en el punto donde se calcula el giro del canon.
- Un test de integración que verifique el override *a través de* la propiedad.

Así el punto de extensión queda **modelado y probado hoy** sin inventar ni un
solo campo de `Propiedad`.

### Alternativa descartada (obligatoria por `docs/specs.md`)

**Descartada: añadir ya `cuenta_bancaria.propiedad_id uuid NULL`** y crear la
FK después, en #6.

Motivos del descarte:
- Dejaría una columna sin FK durante toda la vida de #5, es decir un agujero
  de integridad referencial que nada impide llenar con basura, y **el propio
  RLS no lo cubriría** (no hay tabla contra la que validar el tenant).
- Invierte la dirección del PRD: el override es un atributo **de la
  propiedad** (RF-P1, grupo contable), no de la cuenta. Con `propiedad_id` en
  la cuenta, "¿qué cuenta usa esta propiedad?" pasa a ser una búsqueda inversa
  con reglas ambiguas si hubiera varias filas.
- No se puede probar de forma determinista hoy: sin `Propiedad` no hay ningún
  valor legítimo que poner en la columna, así que el criterio de aceptación
  quedaría "cubierto" solo de palabra.

**Segunda alternativa descartada:** tabla polimórfica
`cuenta_bancaria_asignacion(alcance, alcance_id)`. Resuelve el override
genéricamente, pero renuncia a la FK (mismo problema de integridad) y añade
una indirección que el PRD no pide para un único caso de uso conocido.

---

## 7. Modelo de identidad: tensiones documentadas

**`documento_identidad` en el perfil, no en `user`.** El modelo *preliminar*
del PRD §8.7 lo pone en `User` (global, sin `tenant_id`). Aquí vive en el
perfil, con `UNIQUE (tenant_id, tipo_documento, documento)`. Razón: una
unicidad **global** sobre el documento haría que el intento de registrar a una
persona ya registrada en otra inmobiliaria fallara por colisión, revelando su
existencia — exactamente lo que prohíbe §11.3 y `docs/conventions.md` ("no
confirmes la existencia de recursos ajenos"). Registrado como **PA-7** para que
el humano lo confirme o lo vete.

**El email sí es global** (`user.email` NOT NULL UNIQUE, heredado de #3). Eso
significa que crear un cliente con un email ya existente en otro tenant
*vincula* la identidad. **R20** limita el daño: la respuesta solo contiene el
perfil del tenant actual; nunca nombre, teléfono ni perfiles de otros tenants.
No se cambia el esquema de `user` en este punto (ver **PA-5**).

**Un `user` puede tener perfil de propietario y de inquilino en el mismo
tenant** (RF-C2). Por eso `UNIQUE (tenant_id, user_id)` es por tabla de perfil,
no compartida, y `user_role` (con su `UNIQUE(user_id, tenant_id, rol)` ya
existente) admite ambos roles.

---

## 8. Errores de dominio

Reutilizados:

- `ResourceNotFoundError` (404) — perfil o cuenta inexistente **o de otro
  tenant** (**R25**). No se crea un error distinto para el caso cross-tenant:
  la respuesta debe ser indistinguible.

Nuevos, en `modules/core/clientes/errors/` heredando de `AppError`:

| Error | `code` | HTTP | Cuándo |
|---|---|---|---|
| `PerfilYaExisteError` | `PERFIL_YA_EXISTE` | 409 | R19 — documento ya con perfil en el tenant |
| `CuentaDeGiroInvalidaError` | `CUENTA_DE_GIRO_INVALIDA` | 400 | R23, R24 — override ajeno o sin cuenta resoluble |
| `SinContextoDeTenantError` | `SIN_CONTEXTO_DE_TENANT` | 500 | R28 — repositorio invocado sin `tenantClient` (defecto de programación, no condición esperada) |

`AllExceptionsFilter` ya traduce `AppError` (mensaje propio si `status < 500`),
así que no se toca. `SinContextoDeTenantError` cae en el 500 genérico a
propósito: no debe filtrar detalle al cliente.

---

## 9. Seguridad y datos personales

- **Aislamiento:** RLS `FORCE` en las tres tablas + repositorios que solo usan
  el cliente con `SET LOCAL`. El test de aislamiento se hace contra PostgreSQL
  real (Testcontainers) con un rol sin `BYPASSRLS`, como en `audit-log.test.ts`.
- **RBAC:** `@Roles('admin','empleado')` en los 13 endpoints. El test de
  rechazo por rol es determinista (401/403 comparados por código, sin juicio de
  modelo).
- **Auditoría:** `@Audit(...)` en las 6 mutaciones. `metadata` solo lleva
  identificadores y nombres de campo modificados — **jamás** valores de
  `documento`, `celular`, `email` ni `numero_cuenta` (**R30**). El test
  correspondiente asegura que el JSON de `metadata` no contiene esos valores.
- **`numero_cuenta`** se guarda en columna `text` en claro; el cifrado en
  reposo se resuelve a nivel de almacenamiento (NFR §7), no por columna. No se
  registra en logs ni en auditoría, y solo lo devuelven los endpoints de
  `/cuentas-bancarias` a roles `admin`/`empleado`.
- **Logs:** se mantiene la regla de `docs/conventions.md` — `tenant_id` y
  `request_id`, nunca datos personales.

---

## 10. Dependencias nuevas

**Ninguna.** `zod` (validación de DTOs), `pg`, `drizzle-orm`, `@nestjs/*`,
`@testcontainers/postgresql` y `supertest` ya están en
`apps/api/package.json`.

---

## 11. Archivos

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
apps/api/src/modules/core/core.module.ts           (importar ClientesModule)
apps/api/src/app.module.ts                         (APP_INTERCEPTOR: TenantContextInterceptor)
apps/api/src/common/interceptors/tenant-context.interceptor.ts (tenant = x-tenant-id validado vs JWT — R27)
apps/api/src/modules/core/auth/auth.service.ts     (401 si password_hash IS NULL — R6)
apps/api/src/modules/core/auth/roles.guard.ts      (usar el tenant resuelto, no el header crudo)
apps/api/src/modules/core/__tests__/routes-surface.test.ts (RUTAS_PERMITIDAS +13)
tests/migrations.test.ts                           (TABLAS_PERMITIDAS +3)
apps/api/test/db/migrations.db.test.ts             (verificar tablas + RLS)
apps/api/drizzle/meta/_journal.json                (entrada 5)
packages/types/src/index.ts                        (reexportar clientes)
feature_list.json                                  (#5 → spec_ready)
```

---

## 12. Ambigüedades del PRD trasladadas al humano

Las siete preguntas abiertas están al final de `requirements.md` (**PA-1** a
**PA-7**). Las que bloquean esquema son **PA-2** (columna
`porcentaje_retencion`), **PA-5** (email obligatorio) y **PA-7** (ubicación del
documento): si la respuesta cambia, cambia
`0005_owner_tenant_profiles.sql`, por lo que conviene resolverlas **antes** de
aprobar el spec y no después de migrar.
