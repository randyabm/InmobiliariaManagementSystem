# Design — auditoria

> Feature #4. Auditoría inmutable de acciones críticas.

---

## Arquitectura

```
Handler ejecuta → AuditInterceptor post-execution → AuditService.log() → INSERT audit_log
```

El audit_log es **append-only** por diseño: solo INSERT y SELECT. La inmutabilidad se garantiza a nivel de RLS (políticas que solo permiten INSERT) y por ausencia de endpoints de modificación.

## Entidad de dominio

### `audit_log` (tabla persistente, append-only)

```sql
CREATE TABLE audit_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id),
  actor_id     uuid,
  actor_email  text,
  accion       text NOT NULL,
  entity_type  text NOT NULL,
  entity_id    uuid,
  metadata     jsonb,
  ip_address   inet,
  request_id   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
```

RLS habilitado con FORCE. Política:
- `tenant_id = current_setting('app.current_tenant', true)::uuid`
- Solo INSERT y SELECT (sin UPDATE/DELETE desde la aplicación)

Índices:
- `(tenant_id, created_at)` — consultas por tenant y rango de fechas
- `(entity_type, entity_id)` — buscar auditoría de un recurso específico

## Flujo de auditoría

```
1. Request llega con Authorization: Bearer <token>
2. JwtAuthGuard valida → request.user = { sub, email, roles }
3. TenantContextInterceptor → SET LOCAL app.current_tenant
4. AuditInterceptor detecta @Audit decorator
5. Handler ejecuta lógica de negocio
6. AuditInterceptor post-execution:
   a. Extrae entity_id del response (si está configurado)
   b. Llama a AuditService.log({ tenant_id, actor_id, ... })
   c. AuditService ejecuta INSERT en audit_log
```

## AuditService

```typescript
@Injectable()
export class AuditService {
  async log(entry: AuditEntry): Promise<void> {
    // INSERT dentro de la transacción actual si existe
    // No lanza errores si falla (audit no bloquea)
  }

  async findAll(tenantId: string, filters: AuditFilters): Promise<AuditLog[]> {
    // SELECT con filtros por tenant, acción, entity_type, rango de fechas
  }
}
```

## AuditInterceptor

```typescript
@Audit('login', 'user')
@Post('login')
async login(@Body() dto: LoginDto) { ... }
```

Después de la ejecución, el interceptor:
1. Lee metadata del decorator `@Audit`.
2. Extrae `entity_id` del response (configurable).
3. Obtiene `request.user` para `actor_id` y `actor_email`.
4. Obtiene `request.ip` para `ip_address`.
5. Llama a `AuditService.log(...)`.

## Decorador `@Audit`

```typescript
SetMetadata('audit', { accion: 'login', entityType: 'user' })
```

## Seguridad

- **No datos sensibles**: el campo `metadata` nunca contiene contraseñas, tokens o datos de identidad.
- **Append-only**: RLS solo permite INSERT/SELECT. No existen endpoints de UPDATE/DELETE.
- **Tenant-scoped**: cada registro tiene `tenant_id`; RLS filtra automáticamente.
- **No bloquea**: si el INSERT falla, la operación principal continúa.

## Archivos a crear

```
apps/api/src/database/schema/audit-log.ts
apps/api/src/modules/core/audit/audit.service.ts
apps/api/src/modules/core/audit/audit.interceptor.ts
apps/api/src/modules/core/audit/audit.decorator.ts
apps/api/src/modules/core/audit/audit.module.ts
apps/api/src/modules/core/audit/__tests__/audit.service.test.ts
apps/api/src/modules/core/audit/__tests__/audit.interceptor.test.ts
apps/api/src/database/__tests__/audit-log.test.ts
apps/api/drizzle/0004_auditoria.sql
```

## Archivos a modificar

```
apps/api/src/database/schema/index.ts (export audit_log)
apps/api/src/modules/core/core.module.ts (import AuditModule)
tests/migrations.test.ts (TABLAS_PERMITIDAS: +audit_log)
apps/api/test/db/migrations.db.test.ts (verificar audit_log + RLS)
apps/api/drizzle/meta/_journal.json (entrada 4)
feature_list.json (#4 → done)
```

## Variables de entorno

No se necesitan nuevas variables de entorno. Se reutiliza `DATABASE_URL`.

## Decisión técnica

Se usa `jsonb` para `metadata` porque el contenido varía por tipo de acción
(login vs. sign vs. update) y PostgreSQL permite consultas eficientes sobre
campos JSON. El `actor_email` se almacena como snapshot (no FK) porque el
email del usuario puede cambiar pero el registro de auditoría debe preservar
el valor original al momento de la acción.
