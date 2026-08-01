# Requirements — web_embedding

> Feature #32. Integración WordPress y portales embebibles (RF-INT1..INT6,
> §6.6, D7). Fase 3-4. API-first: el portal es un cliente más de la API.

### R1 — (RF-INT1) Web component embebible
EL sistema DEBE distribuir los portales de inquilino y propietario como un
**web component encapsulado** (Shadow DOM) en `apps/web` (o un bundle
dedicado `apps/web-portal`), registrable por un shortcode de WordPress
(`[portal-inquilino]` / `[portal-propietario]`), de modo que no colisione
con los estilos del tema del tenant.

### R2 — (RF-INT2, RF-INT3) SSO y acceso por subdominio
CUANDO un inquilino/propietario ya autenticado en WordPress (o vía el link
de invitación de #13) abre el portal embebido, el sistema DEBE resolver la
sesión sin doble login mediante un handshake de token seguro
(`POST /portal/sso` con el token firmado del contexto externo que DEBE
canjearse por una sesión real de #27, una sola vez).

### R3 — (RF-INT4) CORS por tenant
LA API DEBE aceptar peticiones SOLO desde los dominios registrados de cada
tenant (`CORS_ORIGINS` por tenant: tabla `tenant_dominio` con
`dominio`, `paquete_web` activo) y DEBE rechazar orígenes arbitrarios.

### R4 — (RF-INT5) White-label
CUANDO el portal se sirve embebido, el sistema DEBE aplicar el theming del
tenant (logo, colores) configurado en `tenant_dominio`/configuración del
tenant.

### R5 — (RF-INT6) Feature flag por tenant
CUANDO el paquete "Integración Web" no está activo para un tenant, el
sistema DEBE rechazar el handshake SSO y NO DEBE servir los portales
embebidos para ese tenant (feature flag en `tenant_dominio.paquete_web`).

### R6 — (RF-C3, C4/C6) Seguridad y migración
SI un handshake SSO usa un token inválido, expirado o ya usado ENTONCES
401 uniforme. Migración única con `tenant_dominio` (RLS ENABLE+FORCE,
UNIQUE (tenant, dominio), CHECK paquete_web en ('portal_inquilino',
'portal_propietario', 'web_completo')); `TABLAS_PERMITIDAS` (+1) y
`RUTAS_PERMITIDAS` (+2: `POST /portal/sso`, `GET /portal/config`) actualizadas.

## DECISIONES de la puerta
| Id | Decisión |
|---|---|
| PA-32-1 | El web component se compila como bundle separado en `apps/web` (`src/portal/`) con Shadow DOM; el shortcode de WordPress se documenta, no se distribuye un plugin en esta iteración |
| PA-32-2 | El handshake SSO usa un token de un solo uso con expiración de 5 min firmado con el JWT del sistema; `POST /portal/sso` lo canjea por una sesión real de #27 |
| PA-32-3 | `CORS_ORIGINS` pasa de configuración global a resolución por tenant en el middleware de CORS (frontera con la feature #2 multitenancy_rls si aplica) |

Sin preguntas de producto abiertas.
