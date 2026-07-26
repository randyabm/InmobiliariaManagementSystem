# Tasks — auth_rbac

> Feature #3. Pasos de implementación en orden.

---

- [x] T1 — Instalar dependencias: `bcrypt`, `@nestjs/jwt`, `@nestjs/passport`, `passport`, `passport-jwt` y sus types. **Cubre: dependencias.**

- [x] T2 — Añadir `JWT_SECRET` y `JWT_EXPIRATION` a `init.sh` (generar secret con `openssl rand -hex 32`). **Cubre: configuración.**

- [x] T3 — Crear `apps/api/src/database/schema/user.ts` con esquema Drizzle de la tabla `user` (id uuid PK, email unique, password_hash, nombre, telefono, created_at, updated_at). **Cubre: R1.**

- [x] T4 — Crear `apps/api/src/database/schema/user-role.ts` con esquema Drizzle de la tabla `user_role` (id uuid PK, user_id FK, tenant_id FK, rol, activo, created_at, UNIQUE constraint). **Cubre: R2.**

- [x] T5 — Actualizar `apps/api/src/database/schema/index.ts` para exportar `user` y `user_role`. **Cubre: R12.**

- [x] T6 — Crear la migración `0003_auth_rbac.sql` que cree las tablas `user` y `user_role`, habilite RLS con FORCE, y cree las políticas de aislamiento por tenant. **Cubre: R11.**

- [x] T7 — Crear `apps/api/src/modules/core/auth/roles.decorator.ts` con el decorador `@Roles(...)`. **Cubre: R7.**

- [x] T8 — Crear `apps/api/src/modules/core/auth/jwt-auth.guard.ts` con `JwtAuthGuard` que valide el token Bearer y adjunte `request.user`. **Cubre: R5.**

- [x] T9 — Crear `apps/api/src/modules/core/auth/roles.guard.ts` con `RolesGuard` que verifique los roles del usuario contra el tenant actual. **Cubre: R7.**

- [x] T10 — Crear `apps/api/src/modules/core/auth/auth.service.ts` con `login()` (bcrypt + JWT sign), `findByEmail()`, `findRolesByUser()`. **Cubre: R3, R4.**

- [x] T11 — Crear `apps/api/src/modules/core/auth/auth.controller.ts` con `POST /auth/login` y `GET /auth/me` (protegido). **Cubre: R3, R8.**

- [x] T12 — Crear `apps/api/src/modules/core/auth/auth.module.ts` que importe JwtModule, PassportModule, y registre AuthService, AuthController. **Cubre: estructura.**

- [x] T13 — Actualizar `TenantContextInterceptor` para extraer `tenant_id` del JWT (`request.user`) con fallback al header `x-tenant-id`. **Cubre: R6.**

- [x] T14 — Actualizar `core.module.ts` para importar `AuthModule`. **Cubre: integración.**

- [x] T15 — Crear tests unitarios `auth.service.test.ts` y `auth.controller.test.ts`. **Cubre: tests unitarios.**

- [x] T16 — Crear tests de integración `auth-rbac.test.ts` contra Testcontainers (login exitoso, credenciales inválidas, RBAC, aislamiento cross-tenant). **Cubre: R9, R10.**

- [x] T17 — Actualizar `tests/migrations.test.ts` para añadir `'user'` y `'user_role'` a `TABLAS_PERMITIDAS`. **Cubre: R12.**

- [x] T18 — Actualizar `apps/api/test/db/migrations.db.test.ts` para verificar que `user` y `user_role` existen con RLS. **Cubre: R11.**

- [x] T19 — Ejecutar `npm run lint`, `npm run typecheck`, `npm run test` y `npm run build`. Todo debe pasar. **Verificación final.**

- [x] T20 — Ejecutar `./init.sh` y verificar que todo está verde. **Cierre de sesión.**
