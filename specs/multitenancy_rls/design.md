# Design — multitenancy_rls

> Feature #2. Decisiones técnicas para multi-tenancy con Row-Level Security.

---

## Decisión central (D2 del PRD)

BD compartida + RLS de PostgreSQL por `tenant_id`. El aislamiento lo fuerza
el motor, no el ORM ni el código de aplicación. Escala a miles de tenants
sin migraciones N veces.

## Arquitectura de la solución

### 3 capas, 3 responsabilidades

1. **Migración SQL** — crea la tabla `tenant`, habilita RLS, crea la
   política. Vive en `apps/api/drizzle/`. Se aplica con `db:migrate`.
2. **Propagación de contexto** — establece `SET LOCAL app.current_tenant`
   en la conexión antes de cada consulta. Vive en un interceptor NestJS.
3. **Validación en tests** — demuestra que RLS funciona contra PostgreSQL
   real (Testcontainers). No hay mocking del motor.

### Capa 1: Migración

Nueva migración `0001_tenant_rls.sql`:

```sql
-- Tabla tenant
CREATE TABLE IF NOT EXISTS "tenant" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "nombre" text NOT NULL,
  "nit" citext NOT NULL UNIQUE,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE "tenant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant" FORCE ROW LEVEL SECURITY;

-- Política: filtra por app.current_tenant
CREATE POLICY "tenant_isolation" ON "tenant"
  USING ("id" = current_setting('app.current_tenant')::uuid);
```

**Nota:** La política en `tenant` filtra por `id = app.current_tenant`. Para
tablas futuras (properties, contracts, etc.), la política será
`tenant_id = current_setting('app.current_tenant')::uuid`. Esta migración
solo crea `tenant` porque es la primera tabla de negocio.

### Capa 2: Propagación del contexto

**Interceptor NestJS:** `TenantContextInterceptor`

1. Extrae `tenant_id` del token JWT (feature #3) o de un header de
   prueba (`x-tenant-id`) para tests.
2. Abre una transacción en el pool de `pg`.
3. Ejecuta `SET LOCAL app.current_tenant = '<uuid>'`.
4. Pasa la conexión transaccional al contexto de la petición.
5. Al finalizar la petición, hace commit/rollback.

**Por ahora (sin auth):** Se usa el header `x-tenant-id` para poder
ejercitar el RLS en tests antes de que exista la feature #3 (auth).

**Con auth (feature #3):** El interceptor extrae el tenant del JWT.

### Capa 3: Tests

**Test de aislamiento (R8):**
- Crea dos tenants (A y B) en PostgreSQL real via Testcontainers.
- Inserta una fila en una tabla de negocio para el tenant A.
- Configura `app.current_tenant = B`.
- Verifica que SELECT no devuelve la fila de A.

**Test de fallo sin contexto (R9):**
- Sin establecer `app.current_tenant`, consulta una tabla con RLS.
- Verifica que devuelve 0 filas (no error, no todos los datos).

## Archivos afectados

| Archivo | Acción | Cubre |
|---------|--------|-------|
| `apps/api/drizzle/0001_tenant_rls.sql` | **Crear.** Migración con tabla + RLS + política. | R1–R4, R10 |
| `apps/api/src/database/schema/index.ts` | **Modificar.** Definir esquema Drizzle de `tenant`. | R1, R2 |
| `apps/api/src/database/schema/tenant.ts` | **Crear.** Entidad `tenant` en Drizzle. | R1 |
| `apps/api/src/common/interceptors/tenant-context.interceptor.ts` | **Crear.** Interceptor que propaga `app.current_tenant`. | R5 |
| `apps/api/src/database/__tests__/tenant-rls.test.ts` | **Crear.** Tests de aislamiento y fallo sin contexto contra PostgreSQL real. | R6, R8, R9 |
| `apps/api/test/db/migrations.db.test.ts` | **Modificar.** Verificar que la tabla `tenant` existe y tiene RLS después de migrar. | R3 |
| `tests/migrations.test.ts` | **Modificar.** Añadir `tenant` a `TABLAS_PERMITIDAS`. | R11 |

## Alternativas descartadas

1. **Schema por tenant (PostgreSQL schemas):** Más aislamiento pero más
   complejidad. Cada tenant tendría su propio schema. Se descartó porque
   D2 del PRD define BD compartida + RLS, y porque escalar a miles de
   tenants con schemas separados es más costoso.

2. **Separación por bases de datos:** Máximo aislamiento pero inadmisible
   operativamente (miles de BD = miles de migraciones). D2 lo descarta
   explícitamente.

3. **Filtrado en el ORM (sin RLS):** Un solo olvido en un WHERE filtra
   datos entre tenants. La architecture.md lo prohíbe: "Si el aislamiento
   dependiera de que cada WHERE incluya tenant_id, un solo olvido filtra
   datos entre inmobiliarias."

## Detalle de RLS

### SET LOCAL vs SET

Se usa `SET LOCAL` (no `SET`) porque el valor vive solo en la transacción
actual. Al hacer commit o rollback, el valor desaparece. Esto evita que
una conexión devuelta al pool retenga el tenant de una petición anterior.

### FORCE ROW LEVEL SECURITY

`FORCE` aplica las políticas incluso al owner de la tabla (usualmente el
usuario de la BD). Sin esto, el owner podría leer todo. En producción el
usuario de la app no es owner, pero en tests sí — FORCE garantiza que los
tests de aislamiento sean válidos.

### Valores de `app.current_tenant`

- **Establecido:** RLS filtra por `id = current_setting('app.current_tenant')::uuid`.
- **No establecido:** `current_setting()` retorna una cadena vacía, que
  no coincide con ningún UUID. Resultado: 0 filas. No hay error, no hay
  filtrado. Es el comportamiento deseado (R6).
