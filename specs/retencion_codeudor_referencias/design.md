# Design — retencion_codeudor_referencias

> Feature #25. Tarifa de retención por tenant (D-2) y codeudores /
> coarrendatarios / referencias del inquilino (D-6).
> Este documento asume `docs/architecture.md` y `docs/conventions.md`; solo
> documenta los puntos donde la feature roza sus fronteras.

---

## 1. Origen y dependencia de la feature #5

Esta feature se separó de la #5 `owner_tenant_profiles` por decisión del humano:
el spec unificado tenía 44 requirements y 55 tasks, y un diff de ese tamaño no
es revisable. El corte deja en #5 el núcleo (perfiles, cuenta bancaria,
identidad, contexto de tenant) y aquí los añadidos.

**Dependencia dura: #25 requiere que #5 esté `done`.** Da por hechos:

| Elemento entregado por #5 | Uso aquí |
|---|---|
| `perfil_inquilino` con RLS | FK de `codeudor_inquilino` y `referencia_inquilino` |
| `perfil_propietario.sujeto_retencion` | Entrada de la resolución de retención (R8, R10) |
| `obtenerClienteTenant(request)` + `SinContextoDeTenantError` | Acceso a datos de los repositorios nuevos (R22) |
| `TenantContextInterceptor` registrado como `APP_INTERCEPTOR` | Contexto RLS de toda petición (no se vuelve a tocar) |
| `RolesGuard` sobre el tenant resuelto + `@Roles` | RBAC de las 10 rutas nuevas (R20, R21) |
| `AuditService` + `@Audit` (#4) | Auditoría de las 7 mutaciones (R23) |
| `ResourceNotFoundError` | 404 indistinguible para recursos de otro tenant (R19) |

Las FK hacia `perfil_inquilino` hacen que la migración **falle** si #5 no se
aplicó: la dependencia queda forzada por el motor, no por la disciplina del
equipo.

---

## 2. Ubicación: se extiende el módulo de #5

No se crea un módulo nuevo. Se añaden archivos a
`apps/api/src/modules/core/clientes/`:

```
modules/core/clientes/
├── retencion.{controller,service,repository}.ts      # D-2
├── codeudores.{controller,service,repository}.ts     # D-6
├── referencias.{controller,service,repository}.ts    # D-6
├── dto/            (+ crear-codeudor, actualizar-codeudor,
│                      crear-referencia, actualizar-referencia,
│                      establecer-tarifa)
├── errors/         (+ TarifaRetencionNoConfiguradaError, CodeudorYaExisteError)
└── __tests__/      (+ tests de esta feature)
```

Motivo: `clientes/` vive en `core/`, del que dependen todos los módulos y que no
depende de ninguno (`docs/architecture.md`). La tarifa de retención la
consumirá el módulo de pagos/contable, y los codeudores el de contratos/firma;
ambos podrán importar el servicio público de `core/clientes` sin crear
dependencias entre módulos hermanos.

**Alternativa descartada:** crear `modules/configuracion/` para la tarifa por
ser "configuración del tenant". Se descarta porque el único consumidor conocido
de la tarifa es el giro del canon del propietario, cuyos datos fiscales ya viven
en `core/clientes`; un módulo aparte obligaría a un contrato entre módulos para
leer `sujeto_retencion` y partiría en dos la misma regla de negocio. Si en el
futuro aparece configuración de tenant heterogénea (umbrales de alertas RF-CT8,
IPC RF-CT11), ese será el momento de extraer un módulo de configuración, con
`tarifa_retencion` como primer inquilino.

---

## 3. Acceso a datos

Idéntico a #5, sin excepciones: los repositorios reciben el `PoolClient` de la
transacción vía `obtenerClienteTenant(request)`; **ninguno** llama a
`getDatabasePool()`. Una consulta sin `SET LOCAL app.current_tenant` debe
fallar, no devolver filas de más (**R22**).

Los repositorios son el único lugar con SQL parametrizado. Los esquemas Drizzle
en `database/schema/` siguen siendo la fuente declarativa del esquema.

---

## 4. Migración (la siguiente libre, previsiblemente `0006_retencion_codeudor_referencias.sql`)

> El número exacto depende de qué features se hayan implementado antes. El
> `implementer` debe tomar el siguiente índice libre de `apps/api/drizzle/` y
> reflejarlo en `meta/_journal.json`.

Forward-only e idempotente. **Sí habilita RLS** (`ENABLE` + `FORCE` + política
por `tenant_id`) en las tres tablas nuevas, en la misma migración que las crea
(**R4**, `docs/conventions.md`).

Contenido:

1. `CREATE TABLE IF NOT EXISTS tarifa_retencion (...)` — campos de **R1**, con
   `UNIQUE (tenant_id, anio)` y `porcentaje numeric(5,2)`.
2. `CREATE TABLE IF NOT EXISTS codeudor_inquilino (...)` — **R2**, con
   `perfil_inquilino_id` FK → `perfil_inquilino(id)` y
   `UNIQUE (tenant_id, perfil_inquilino_id, tipo_documento, documento)`.
3. `CREATE TABLE IF NOT EXISTS referencia_inquilino (...)` — **R3**, con
   `perfil_inquilino_id` FK → `perfil_inquilino(id)`.
4. RLS en las tres: `ENABLE`, `FORCE` y política
   `USING (tenant_id = current_setting('app.current_tenant', true)::uuid)`, con
   el mismo patrón `DO $$ IF NOT EXISTS (SELECT 1 FROM pg_policies ...)` de
   `0003`/`0004`/`0005`.
5. Índices de consulta: `codeudor_inquilino (tenant_id, perfil_inquilino_id)`,
   `referencia_inquilino (tenant_id, perfil_inquilino_id)`. La UNIQUE de
   `tarifa_retencion` ya sirve de índice de acceso por (`tenant_id`, `anio`).
6. Entrada nueva en `apps/api/drizzle/meta/_journal.json`.

**La migración NO añade ninguna columna a `perfil_propietario`** (**R5**): la
tarifa no se duplica en el perfil (D-2). Un test lo verifica contra
`information_schema.columns`.

Todas las fechas `timestamptz`; `anio` es `integer` (año calendario, no fecha:
la tarifa aplica al año fiscal completo).

---

## 5. Superficie HTTP (10 rutas)

Todos los endpoints: `@UseGuards(JwtAuthGuard, RolesGuard)`. Roles
`admin`/`empleado` en codeudores y referencias; **solo `admin`** en
`/configuracion/retencion` (**R20**, **R21**). Validación de entrada con zod en
el borde. Rutas en kebab-case y plural.

| Método y ruta | Servicio | Requirements | Auditoría |
|---|---|---|---|
| `GET /configuracion/retencion` | `RetencionService.listar` | R7, R19, R21 | — |
| `PUT /configuracion/retencion/:anio` | `RetencionService.establecer` | R6, R11, R19, R21 | `@Audit('actualizar','tarifa_retencion')` |
| `POST /inquilinos/:id/codeudores` | `CodeudoresService.crear` | R12, R14, R17, R19 | `@Audit('crear','codeudor_inquilino')` |
| `GET /inquilinos/:id/codeudores` | `.listar` | R13, R19 | — |
| `PATCH /inquilinos/:idInquilino/codeudores/:idCodeudor` | `.actualizar` | R13, R19 | `@Audit('actualizar','codeudor_inquilino')` |
| `DELETE /inquilinos/:idInquilino/codeudores/:idCodeudor` | `.darDeBaja` | R13, R19 | `@Audit('baja','codeudor_inquilino')` |
| `POST /inquilinos/:id/referencias` | `ReferenciasService.crear` | R15, R17, R19 | `@Audit('crear','referencia_inquilino')` |
| `GET /inquilinos/:id/referencias` | `.listar` | R16, R19 | — |
| `PATCH /inquilinos/:idInquilino/referencias/:idReferencia` | `.actualizar` | R16, R19 | `@Audit('actualizar','referencia_inquilino')` |
| `DELETE /inquilinos/:idInquilino/referencias/:idReferencia` | `.darDeBaja` | R16, R19 | `@Audit('baja','referencia_inquilino')` |

`RUTAS_PERMITIDAS` en
`apps/api/src/modules/core/__tests__/routes-surface.test.ts` se amplía con estas
**10** rutas, sin tocar las 13 que registró #5 (**R25**).

### Firmas nuevas relevantes

```ts
// retencion.service.ts — D-2
establecer(anio: number, porcentaje: string, ctx: ContextoPeticion): Promise<TarifaRetencion>;
listar(ctx: ContextoPeticion): Promise<TarifaRetencion[]>;
resolverPorcentaje(anio: number, ctx: ContextoPeticion): Promise<string>;
// lanza TarifaRetencionNoConfiguradaError si el tenant no configuró ese año (R9)

resolverRetencionDePropietario(
  perfilPropietarioId: string,
  anio: number,
  ctx: ContextoPeticion,
): Promise<{ aplica: boolean; porcentaje: string | null }>;
// sujeto_retencion = false → { aplica: false, porcentaje: null } SIN consultar
// tarifa_retencion (R10)

// codeudores.service.ts — D-6
crear(perfilInquilinoId: string, dto: CrearCodeudorDto, ctx: ContextoPeticion): Promise<CodeudorInquilino>;
listar(perfilInquilinoId: string, ctx: ContextoPeticion): Promise<CodeudorInquilino[]>;
actualizar(id: string, dto: ActualizarCodeudorDto, ctx: ContextoPeticion): Promise<CodeudorInquilino>;
darDeBaja(id: string, ctx: ContextoPeticion): Promise<void>;

// referencias.service.ts — D-6 (misma forma)
```

`porcentaje` viaja como `string` en toda frontera pública (**R11**): el driver
`pg` devuelve `numeric` como cadena y convertirlo a `number` introduciría error
de coma flotante en un valor con consecuencias fiscales
(`docs/conventions.md`, "Dinero y fechas").

Tipos compartidos (`TarifaRetencion`, `CodeudorInquilino`, `TipoCodeudor`,
`ReferenciaInquilino`) se añaden a `packages/types/src/clientes.ts`, el archivo
que creó #5.

---

## 6. Frontera del cálculo: qué resuelve #25 y qué no

- **#25 resuelve el porcentaje aplicable**: si el propietario es sujeto de
  retención y qué tarifa rige ese año (R8, R9, R10).
- **#25 no calcula dinero.** Aplicar el porcentaje al canon, redondear y
  registrar el giro pertenece al módulo de pagos/conciliación (PRD §15) y a la
  feature que lo implemente. Aquí no aparece ningún importe.
- **#5 no calcula nada de retención** (su R17 lo prohíbe explícitamente): solo
  captura y devuelve `sujeto_retencion`.

Esta separación evita el error clásico de tener dos sitios que "saben" la
tarifa. Punto único de verdad: `tarifa_retencion`.

### Pendiente heredado del PRD §13.5

El PRD deja abierta la fuente del IPC (carga manual anual por el admin vs.
integración con el DANE) y recomienda carga manual para el MVP. La tarifa de
retención tiene exactamente el mismo problema y se resuelve igual: **carga
manual por el `admin`** (R6) y **sin valor por defecto** (R9), de modo que un año
sin configurar produce un error explícito en vez de un cálculo silenciosamente
incorrecto. `tarifa_retencion` es el punto de enchufe si algún día se integra
una fuente externa.

---

## 7. Frontera con la firma del contrato (D-6)

**Dentro de #25:** modelado, RLS, CRUD expuesto, auditoría y aislamiento de
codeudores/coarrendatarios y referencias. Es **captura de datos** de la hoja de
vida del inquilino (RF-C4).

**Fuera de #25**, explícitamente:

- Cualquier FK hacia contrato, firma, inventario u OTP (**R18**, verificado con
  una consulta a `information_schema.table_constraints`).
- La condición legal del codeudor como firmante (RF-CT4, RF-C4 "ligado a la
  firma") y la verificación de identidad previa a la firma (RF-AU3).
- Notificaciones al codeudor (RF-N1).

**Dependencia registrada para #14/#17:** deberán añadir la relación
codeudor ↔ firmante declarando la FK **desde** la tabla de firmas hacia
`codeudor_inquilino`, no al revés, para no invertir la dirección de dependencia
entre módulos ni obligar a `core/clientes` a conocer el módulo de contratos.

---

## 8. Errores de dominio

Reutilizados de #5 / del núcleo:

- `ResourceNotFoundError` (404) — tarifa, codeudor o referencia inexistente **o
  de otro tenant** (**R19**). No se crea un error distinto para el caso
  cross-tenant: la respuesta debe ser indistinguible.
- `SinContextoDeTenantError` (500) — **R22**.

Nuevos, en `modules/core/clientes/errors/` heredando de `AppError`:

| Error | `code` | HTTP | Cuándo |
|---|---|---|---|
| `TarifaRetencionNoConfiguradaError` | `TARIFA_RETENCION_NO_CONFIGURADA` | 409 | R9 — el tenant no configuró la tarifa del año solicitado |
| `CodeudorYaExisteError` | `CODEUDOR_YA_EXISTE` | 409 | R14 — mismo documento ya registrado para ese inquilino |

`AllExceptionsFilter` ya traduce `AppError` (mensaje propio si `status < 500`),
así que no se toca.

---

## 9. Seguridad y datos personales

- **Aislamiento:** RLS `FORCE` en las tres tablas + repositorios que solo usan el
  cliente con `SET LOCAL`. El test de aislamiento se hace contra PostgreSQL real
  (Testcontainers) con un rol sin `BYPASSRLS`, como en `audit-log.test.ts` y
  `clientes-rls.test.ts` (#5).
- **RBAC:** `@Roles('admin','empleado')` en las 8 rutas de codeudores y
  referencias; `@Roles('admin')` en las 2 de `/configuracion/retencion`. Tests
  deterministas por código de estado (401/403), sin juicio de modelo.
- **Auditoría:** `@Audit(...)` en las 7 mutaciones. `metadata` solo lleva
  identificadores y nombres de campo modificados — **jamás** valores de
  `documento`, `celular`, `telefono` ni `email` (**R24**).
- **Datos de terceros:** un codeudor y una referencia son personas que **no** son
  usuarias del sistema. No se les crea `user` ni `user_role`, no se les envía
  nada en esta feature y sus datos solo los ven `admin`/`empleado` del tenant
  (Ley 1581 de 2012: minimización).
- **Logs:** `tenant_id` y `request_id`, nunca datos personales
  (`docs/conventions.md`).

---

## 10. Dependencias nuevas

**Ninguna.** `zod`, `pg`, `drizzle-orm`, `@nestjs/*`,
`@testcontainers/postgresql` y `supertest` ya están en
`apps/api/package.json`.

---

## 11. Archivos

### Se crean

```
apps/api/drizzle/000X_retencion_codeudor_referencias.sql   (siguiente índice libre)
apps/api/src/database/schema/tarifa-retencion.ts
apps/api/src/database/schema/codeudor-inquilino.ts
apps/api/src/database/schema/referencia-inquilino.ts
apps/api/src/modules/core/clientes/retencion.{controller,service,repository}.ts
apps/api/src/modules/core/clientes/codeudores.{controller,service,repository}.ts
apps/api/src/modules/core/clientes/referencias.{controller,service,repository}.ts
apps/api/src/modules/core/clientes/dto/{establecer-tarifa,crear-codeudor,actualizar-codeudor,crear-referencia,actualizar-referencia}.dto.ts
apps/api/src/modules/core/clientes/errors/{tarifa-retencion-no-configurada,codeudor-ya-existe}.error.ts
apps/api/src/modules/core/clientes/__tests__/{retencion,codeudores,referencias}.test.ts
apps/api/src/database/__tests__/retencion-codeudor-rls.test.ts
```

### Se modifican

```
apps/api/src/database/schema/index.ts              (exportar los 3 esquemas nuevos)
apps/api/src/modules/core/clientes/clientes.module.ts (registrar los 3 controllers y servicios)
apps/api/src/modules/core/__tests__/routes-surface.test.ts (RUTAS_PERMITIDAS +10)
tests/migrations.test.ts                           (TABLAS_PERMITIDAS +3)
apps/api/test/db/migrations.db.test.ts             (verificar las 3 tablas + RLS)
apps/api/drizzle/meta/_journal.json                (entrada nueva)
packages/types/src/clientes.ts                     (tipos de tarifa, codeudor y referencia)
feature_list.json                                  (#25 → spec_ready)
```

---

## 12. Estado de las ambigüedades

No queda ninguna decisión de producto pendiente. Lo registrado como pendiente
técnico —no de producto— es la fuente externa de la tarifa (§6, heredado del
pendiente del IPC en el PRD §13.5), resuelto para el MVP con carga manual por el
`admin`. Los certificados de retención siguen diferidos al módulo contable
(decisión **D-3**, tomada en el spec de #5).
