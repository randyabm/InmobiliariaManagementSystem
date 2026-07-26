# Requisitos — auditoria

> Feature #4. Auditoría inmutable de acciones críticas.
> Anclaje: RF-W4, NFR auditoría (sección 7), invariantes de seguridad (11.3).

---

## Requisitos

### R1 — Tabla `audit_log`

El sistema debe almacenar registros de auditoría append-only con:
- `id` uuid PK (gen_random_uuid)
- `tenant_id` uuid NOT NULL FK → `tenant(id)`
- `actor_id` uuid — nullable (acciones del sistema)
- `actor_email` text — email del actor (snapshot, no FK)
- `accion` text NOT NULL (ej: `login`, `logout`, `create`, `update`, `delete`, `sign`, `access_document`)
- `entity_type` text NOT NULL (ej: `user`, `tenant`, `inventario`, `contrato`)
- `entity_id` uuid — id del recurso afectado
- `metadata` jsonb — datos adicionales de la acción (sin datos sensibles)
- `ip_address` inet — IP del actor
- `request_id` text — correlación con logs de aplicación
- `created_at` timestamp NOT NULL DEFAULT now()

RLS habilitado y forzado. La política filtra por `tenant_id`.

### R2 — Append-only (no modificable)

La tabla `audit_log` debe ser inmutable desde la aplicación:
- Ningún endpoint permite UPDATE o DELETE sobre `audit_log`.
- Las políticas RLS solo permiten INSERT y SELECT.
- No se expone un endpoint de modificación de auditoría.

### R3 — AuditService

Un servicio NestJS `AuditService` debe:
1. Exponer `log(entry: AuditEntry): Promise<void>` para registrar eventos.
2. Extraer `actor_id`, `actor_email`, `ip_address`, `request_id` del request actual (via `ExecutionContext`).
3. Ejecutar INSERT en `audit_log` dentro de la transacción actual si existe.
4. No lanzar errores si el INSERT falla (la auditoría no debe bloquear la operación principal).

### R4 — AuditInterceptor

Un interceptor NestJS `AuditInterceptor` debe:
1. Después de que el handler se ejecute, registrar la acción en `audit_log`.
2. Extraer metadata del resultado (entity_type, entity_id) del response.
3. Ser configurable con un decorador `@Audit('accion', 'entity_type')`.
4. No interceptar endpoints de login ni healthcheck.

### R5 — Decorador `@Audit`

Un decorador `@Audit(accion, entityType)` que:
1. Se aplica a handlers de controllers.
2. Provee metadata para que `AuditInterceptor` sepa qué registrar.
3. Soporta parámetros opcionales para extraer entity_id del response.

### R6 — Tests de inmutabilidad

Tests contra Testcontainers (PostgreSQL real):
- INSERT de un registro de auditoría funciona.
- UPDATE sobre `audit_log` falla o no tiene efecto (RLS o constraint).
- DELETE sobre `audit_log` falla o no tiene efecto (RLS o constraint).
- SELECT funciona normalmente.

### R7 — Tests de integración

Tests contra Testcontainers (PostgreSQL real):
- Login exitoso genera entrada de auditoría con `accion='login'`.
- La entrada tiene actor_id, tenant_id, ip_address y timestamp correctos.
- Sin contexto de tenant, la inserción falla o no tiene efecto.

### R8 — Migración

La migración `0004_auditoria.sql` debe:
- Crear la tabla `audit_log`.
- Habilitar RLS con FORCE.
- Crear la política de tenant isolation.
- Crear un índice en `(tenant_id, created_at)` para consultas por tenant y rango de fechas.

### R9 — Exportaciones

- `apps/api/src/database/schema/index.ts` debe exportar el esquema de `audit_log`.
- `tests/migrations.test.ts` debe incluir `'audit_log'` en `TABLAS_PERMITIDAS`.
- `apps/api/test/db/migrations.db.test.ts` debe verificar que `audit_log` existe con RLS.
