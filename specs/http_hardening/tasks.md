# Tasks — http_hardening

> Feature #24. Pasos de implementación en orden.

---

- [x] T1 — Crear directorio `apps/api/src/common/headers/` y el archivo
  `seguridad-headers.interceptor.ts` con el interceptor NestJS que setea
  las cabeceras estáticas (HSTS, X-Content-Type-Options, Referrer-Policy,
  CSP). **Cubre: R2, R3, R4, R5.**

- [x] T2 — En `bootstrap.ts`, invocar `expressApp.disable('x-powered-by')`
  vía `app.getHttpAdapter().getInstance()` antes de registrar interceptores.
  **Cubre: R1.**

- [x] T3 — Registrar el interceptor `SeguridadHeadersInterceptor` en
  `configureApp()`. **Cubre: R2–R5.**

- [x] T4 — Crear `frame-ancestors-por-tenant.interceptor.ts` que resuelve
  `frame-ancestors` dinámico según los dominios del tenant. Para el MVP,
  usar una constante de dominios de ejemplo. **Cubre: R6.**

- [x] T5 — Registrar `FrameAncetorsPorTenantInterceptor` en
  `configureApp()`. **Cubre: R6.**

- [x] T6 — Crear `seguridad-headers.test.ts` con tests que verifiquen
  que todas las cabeceras (R1–R5) están presentes en la respuesta a un
  endpoint de salud. **Cubre: R7.**

- [x] T7 — Crear `frame-ancestors.test.ts` con tests que verifiquen
  que un origin no listado no aparece en `frame-ancestors`. **Cubre: R8.**

- [x] T8 — Ejecutar `npm run lint`, `npm run typecheck`, `npm run test`
  y `npm run build`. Todo debe pasar. **Verificación final.**

- [x] T9 — Ejecutar `./init.sh` y verificar que todo está verde.
  **Cierre de sesión.**
