# Tasks — auditoria

> Feature #4. Pasos de implementación en orden.

---

- [x] T1 — Crear `apps/api/src/database/schema/audit-log.ts` con esquema Drizzle de la tabla `audit_log`. **Cubre: R1.**

- [x] T2 — Actualizar `apps/api/src/database/schema/index.ts` para exportar `auditLog`. **Cubre: R9.**

- [x] T3 — Crear la migración `0004_auditoria.sql` con la tabla `audit_log`, RLS habilitado/forzado, política de tenant isolation e índice compuesto. **Cubre: R8.**

- [x] T4 — Actualizar `apps/api/drizzle/meta/_journal.json` con la entrada 4. **Cubre: R8.**

- [x] T5 — Crear `apps/api/src/modules/core/audit/audit.decorator.ts` con el decorador `@Audit(accion, entityType)`. **Cubre: R5.**

- [x] T6 — Crear `apps/api/src/modules/core/audit/audit.service.ts` con `log()` (INSERT) y `findAll()` (SELECT con filtros). **Cubre: R3.**

- [x] T7 — Crear `apps/api/src/modules/core/audit/audit.interceptor.ts` que después del handler extraiga metadata del decorator y response, y llame a `AuditService.log()`. **Cubre: R4.**

- [x] T8 — Crear `apps/api/src/modules/core/audit/audit.module.ts` que registre AuditService, AuditInterceptor y exporte AuditModule. **Cubre: estructura.**

- [x] T9 — Actualizar `apps/api/src/modules/core/core.module.ts` para importar `AuditModule`. **Cubre: integración.**

- [x] T10 — Crear tests de integración `audit-log.test.ts`: INSERT funciona, UPDATE/DELETE lanza error (triggers append-only), SELECT funciona. **Cubre: R6.**

- [x] T11 — Crear tests de integración: login genera entrada de auditoría con campos correctos. **Cubre: R7.**

- [x] T12 — Actualizar `tests/migrations.test.ts` para añadir `'audit_log'` a `TABLAS_PERMITIDAS`. **Cubre: R9.**

- [x] T13 — Actualizar `apps/api/test/db/migrations.db.test.ts` para verificar que `audit_log` existe con RLS y políticas. **Cubre: R9.**

- [x] T14 — Ejecutar `npm run lint`, `npm run typecheck`, `npm run test` y `npm run build`. Todo debe pasar. **Verificación final.**

- [x] T15 — Ejecutar `./init.sh` y verificar que todo está verde. **Cierre de sesión.**
