# Tasks — multitenancy_rls

> Feature #2. Pasos de implementación en orden.

---

- [x] T1 — Crear `apps/api/src/database/schema/tenant.ts` con el esquema
  Drizzle de la tabla `tenant` (id uuid PK, nombre text, nit text unique,
  created_at, updated_at). **Cubre: R1.**

- [x] T2 — Actualizar `apps/api/src/database/schema/index.ts` para exportar
  el esquema de `tenant`. **Cubre: R1.**

- [x] T3 — Crear la migración `0001_tenant_rls.sql` con tabla `tenant`,
  `ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY` y política
  `tenant_isolation`. Corregida en `0002_fix_rls_policy.sql` para usar
  `current_setting(..., true)` (missing_ok). **Cubre: R1–R4, R10.**

- [x] T4 — Crear `apps/api/src/common/interceptors/tenant-context.interceptor.ts`
  con un interceptor NestJS que extraiga `x-tenant-id` del header, abra una
  transacción y ejecute `SET LOCAL app.current_tenant = '<uuid>'` antes de
  cualquier consulta. **Cubre: R5.**

- [x] T5 — Actualizar `tests/migrations.test.ts` para añadir `'tenant'` a
  `TABLAS_PERMITIDAS`. **Cubre: R11.**

- [x] T6 — Actualizar `apps/api/test/db/migrations.db.test.ts` para verificar
  que la tabla `tenant` existe con RLS habilitado y la política existe.
  **Cubre: R3, R4.**

- [x] T7 — Crear `apps/api/src/database/__tests__/tenant-rls.test.ts` con:
  - Test R8: tenant A no ve datos de tenant B (Testcontainers, PostgreSQL real).
  - Test R9: sin contexto de tenant, la consulta falla o retorna 0 filas.
  - Test R5: contexto de tenant propaga correctamente.
  **Cubre: R5, R6, R8, R9.**

- [x] T8 — Ejecutar `npm run lint`, `npm run typecheck`, `npm run test` y
  `npm run build`. Todo debe pasar. **Verificación final.**

- [x] T9 — Ejecutar `./init.sh` y verificar que todo está verde.
  **Cierre de sesión.**
