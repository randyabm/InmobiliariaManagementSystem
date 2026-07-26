# Design — http_hardening

> Feature #24. Decisiones técnicas para endurecimiento de cabeceras HTTP.

---

## Enfoque: NestJS interceptor dedicado

En lugar de usar `helmet` (dependencia de terceros que añade más de lo
necesario y dificulta el control fino), se implementa un interceptor
NestJS propio que configura las cabeceras. Razones:

1. **Control total.** El interceptor aplica exactamente las cabeceras del
   spec, ni más ni menos. No hay sorpresas con defaults de helmet.
2. **Coherencia con CORS.** Ya existe un módulo `common/cors/` con su
   propio builder. El patrón de configuración declarativa se replica para
   las cabeceras de seguridad.
3. **`frame-ancestors` dinámico (R6).** Helmet no soporta resolver
   `frame-ancestors` por tenant de forma dinámica. Un interceptor propio
   puede consultar la configuración del tenant en cada petición.
4. **Sin dependencia nueva.** Se evita añadir `helmet` o
   `@nestjs/helmet` al `package.json`. Express ya soporta
   `app.disable('x-powered-by')` y las cabeceras se setean vía
   interceptor.

## Alternativa descartada

Usar `@nestjs/helmet` directamente en `bootstrap.ts`. Se descartó porque:
- Expone un objeto monolítico de opciones de helmet.
- No facilita la resolución dinámica de `frame-ancestors` por tenant.
- Añade una dependencia que el equipo debe mantener.

## Archivos afectados

| Archivo | Acción | Cubre |
|---------|--------|-------|
| `apps/api/src/common/headers/seguridad-headers.interceptor.ts` | **Crear.** Interceptor NestJS que setea las cabeceras de seguridad. | R1–R5 |
| `apps/api/src/common/headers/frame-ancestors-por-tenant.interceptor.ts` | **Crear.** Interceptor que resuelve `frame-ancestors` dinámico según el tenant de la petición. | R6 |
| `apps/api/src/common/headers/__tests__/seguridad-headers.test.ts` | **Crear.** Tests de integridad de cabeceras. | R7 |
| `apps/api/src/common/headers/__tests__/frame-ancestors.test.ts` | **Crear.** Tests de frame-ancestors por tenant. | R8 |
| `apps/api/src/bootstrap.ts` | **Modificar.** Deshabilitar `x-powered-by` y registrar los interceptores. | R1, R2–R6 |
| `apps/api/test/support/create-test-app.ts` | **Modificar.** Los interceptores se aplican en `configureApp()`, por lo tanto los tests de humo ya los heredan. | — |

## Configuración de cabeceras

```ts
const HEADERS_SEGURIDAD = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "default-src 'self'; frame-ancestors 'self'",
} as const;
```

## frame-ancestors por tenant (R6)

El interceptor `FrameAncetorsPorTenantInterceptor`:

1. Extrae el origin del header `Origin` o `Referer` de la petición.
2. Busca los dominios registrados del tenant en la configuración (por
   ahora, constante; más adelante, base de datos).
3. Si el origin coincide con un dominio registrado, setea
   `frame-ancestors` con ese dominio.
4. Si no coincide, `frame-ancestors` queda en `'self'`.

**Nota de ambigüedad:** El PRD no define la estructura de datos de los
dominios de embebido por tenant (RF-INT4 los menciona pero no dice
dónde se almacenan). Para el MVP se usa una constante que lista los
dominios de ejemplo. Cuando se implemente `multitenancy_rls`, se migrará
a una tabla `tenant_domain`.

## x-powered-by (R1)

Se usa `app.disable('x-powered-by')` de Express, que es la forma
oficial y más directa. Se invoca en `configureApp()` antes de los
interceptores.

## Testing

Los tests usan `supertest` contra la app de prueba (ya existe
`crearAppDePrueba()`). Se verifica que cada cabecera está presente y
tiene el valor correcto. Para R8 se verifica que un origin no listado
no aparece en `frame-ancestors`.
