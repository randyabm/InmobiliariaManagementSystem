# Design — auth_rbac

> Feature #3. Autenticación, identidad multi-rol y RBAC.

---

## Arquitectura

```
POST /auth/login → AuthService.login() → bcrypt.compare → JWT sign → { access_token }
GET  /auth/me    → JwtAuthGuard → RolesGuard → AuthService.getProfile() → { user }
```

## Stack de autenticación

| Componente | Tecnología | Justificación |
|---|---|---|
| Password hashing | `bcrypt` | Simple, battle-tested. Se instala como dependencia. |
| JWT | `@nestjs/jwt` + `jsonwebtoken` | Estándar NestJS, soporte nativo para Guards. |
| Guards | `JwtAuthGuard`, `RolesGuard` | Patrón NestJS estándar para auth + RBAC. |
| Decorador | `@Roles(...)` | Metadata key para RolesGuard. |

## Entidades de dominio

### `user` (tabla persistente)

```sql
CREATE TABLE "user" (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  nombre      text NOT NULL,
  telefono    text,
  created_at  timestamp NOT NULL DEFAULT now(),
  updated_at  timestamp NOT NULL DEFAULT now()
);
```

RLS habilitado. La política de lectura filtra: el usuario puede ser leído si tiene un `user_role` activo en el tenant actual.

### `user_role` (tabla persistente)

```sql
CREATE TABLE user_role (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES "user"(id),
  tenant_id  uuid NOT NULL REFERENCES tenant(id),
  rol        text NOT NULL CHECK (rol IN ('super_admin','admin','empleado','propietario','inquilino')),
  activo     boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(user_id, tenant_id, rol)
);
```

RLS habilitado. Política: `tenant_id = current_setting('app.current_tenant', true)::uuid`.

## JWT payload

```json
{
  "sub": "uuid-del-usuario",
  "email": "user@example.com",
  "roles": [
    { "tenant_id": "uuid-del-tenant", "rol": "admin" },
    { "tenant_id": "uuid-del-tenant-2", "rol": "empleado" }
  ],
  "iat": 1700000000,
  "exp": 1700003600
}
```

## Flujo de login

```
1. POST /auth/login { email, password }
2. AuthService.findByEmail(email) → user or null
3. bcrypt.compare(password, user.password_hash) → boolean
4. Si falla → 401
5. AuthService.findRolesByUser(user.id) → UserRole[]
6. jwtService.sign({ sub, email, roles }) → access_token
7. Retorna { access_token, user: { id, email, nombre } }
```

## Flujo de request autenticado

```
1. Request llega con Authorization: Bearer <token>
2. JwtAuthGuard valida token → request.user = payload
3. TenantContextInterceptor extrae tenant_id del JWT o header
4. SET LOCAL app.current_tenant = '<tenant_id>'
5. RolesGuard verifica que user tiene rol activo para ese tenant
6. Handler ejecuta lógica de negocio
```

## TenantContextInterceptor — cambios

El interceptor existente se modifica para:
1. Intentar extraer `tenant_id` de `request.user?.roles?.[0]?.tenant_id`.
2. Si no hay JWT (rutas públicas), usar header `x-tenant-id` como fallback.
3. El endpoint `POST /auth/login` se excluye del interceptor.

## RolesGuard

```typescript
@SetMetadata('roles', ['admin', 'empleado'])
```

- Lee `@Roles(...)` del handler o clase.
- Compara contra `request.user.roles` filtrando por `tenant_id` actual.
- Si no hay coincidencia → 403.

## Archivos a crear

```
apps/api/src/modules/core/auth/auth.module.ts
apps/api/src/modules/core/auth/auth.service.ts
apps/api/src/modules/core/auth/auth.controller.ts
apps/api/src/modules/core/auth/jwt-auth.guard.ts
apps/api/src/modules/core/auth/roles.guard.ts
apps/api/src/modules/core/auth/roles.decorator.ts
apps/api/src/modules/core/auth/__tests__/auth.service.test.ts
apps/api/src/modules/core/auth/__tests__/auth.controller.test.ts
apps/api/src/database/schema/user.ts
apps/api/src/database/schema/user-role.ts
apps/api/drizzle/0003_auth_rbac.sql
apps/api/src/database/__tests__/auth-rbac.test.ts
```

## Archivos a modificar

```
apps/api/src/modules/core/core.module.ts (importar AuthModule)
apps/api/src/database/schema/index.ts (export user, user_role)
apps/api/src/common/interceptors/tenant-context.interceptor.ts (tenant from JWT)
apps/api/src/bootstrap.ts (registrar AuthModule)
tests/migrations.test.ts (TABLAS_PERMITIDAS: +user, +user_role)
apps/api/test/db/migrations.db.test.ts (verificar user, user_role, RLS)
```

## Dependencias a instalar

```
npm install bcrypt @nestjs/jwt @nestjs/passport passport passport-jwt
npm install -D @types/bcrypt @types/passport-jwt
```

## Variables de entorno

```
JWT_SECRET=<generado-en-init-sh>
JWT_EXPIRATION=3600
```

## Estrategia de migración

Se usa `npm run db:generate` para generar la migración a partir del schema Drizzle.
Si el generador no produce RLS, se escribe manualmente la migración SQL.
