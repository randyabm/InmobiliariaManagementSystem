# Requirements — multitenancy_rls

> Feature #2. Multi-tenancy con Row-Level Security.
> Fuente: RF-A1 (paquetes por tenant), RF-C2 (multi-rol), RF-C3 (RBAC +
> scoping por tenant), RF-AU6 (identidad multi-tenant), D2 (BD compartida +
> RLS), 11.3 (invariantes de seguridad).

---

## R1 — (D2, 11.3) Entidad Tenant

EL sistema DEBE tener una entidad `tenant` con al menos los campos: `id`
(uuid), `nombre`, `nit` (único), `created_at`, `updated_at`.

## R2 — (D2, 11.3) tenant_id en tablas de negocio

TODA tabla de negocio que se cree a partir de esta feature DEBE incluir la
columna `tenant_id` (uuid, FK a `tenant.id`) como parte de su esquema.

## R3 — (D2, RF-A1) RLS habilitado y forzado

CUANDO se crea una tabla de negocio con `tenant_id`, el sistema DEBE
ejecutar `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` y `ALTER TABLE ...
FORCE ROW LEVEL SECURITY` en la misma migración que crea la tabla.

## R4 — (D2, 11.3) Política RLS por tenant

EL sistema DEBE tener una política RLS que, para cada tabla con
`tenant_id`, filtre las filas según el valor de la variable de sesión
`app.current_tenant`. SI `app.current_tenant` no está establecido,
la política DEBE denegar acceso a todas las filas.

## R5 — (D2, 11.3) Propagación del contexto de tenant

CUANDO una petición autenticada llega al backend, el sistema DEBE
establecer `SET LOCAL app.current_tenant = '<tenant_id>'` en la misma
conexión de la transacción, antes de ejecutar cualquier consulta de
negocio.

## R6 — (D2, RF-C3) Consulta sin contexto de tenant falla

SI se ejecuta una consulta sobre una tabla con RLS sin haber establecido
`app.current_tenant` ENTONCES el sistema DEBE retornar 0 filas (no
debe devolver todos los datos).

## R7 — (D2, RF-A1, RF-C3) Aislamiento entre tenants

SI una petición autenticada del tenant A consulta un recurso que pertenece
al tenant B, el sistema DEBE devolver 404 (no 403, no 200 con datos
vacíos) — no se confirma la existencia de recursos ajenos.

## R8 — (D2, RF-A1) Test de aislamiento contra PostgreSQL real

EL sistema DEBE tener al menos un test que, usando Testcontainers con
PostgreSQL real, demuestre que un tenant NO puede leer datos de otro
tenant, incluso si el código de aplicación lo intenta (omitindo el WHERE
o manipulando la conexión).

## R9 — (D2) Test de fallo sin contexto

EL sistema DEBE tener al menos un test que verifique que una consulta
sobre una tabla con RLS sin `app.current_tenant` establecido devuelve 0
filas.

## R10 — (D2, 11.3) Migración idempotente

LA migración que crea la tabla `tenant` y habilita RLS DEBE ser
idempotente y ejecutable múltiples veces sin errores (usando `IF NOT
EXISTS` y `IF NOT EXISTS` para las políticas).

## R11 — (D2) Extensión del guardia de migraciones

LA tabla `TABLAS_PERMITIDAS` en `tests/migrations.test.ts` DEBE
incluir `tenant` para que la creación de la primera tabla de negocio
no falle el test existente.
