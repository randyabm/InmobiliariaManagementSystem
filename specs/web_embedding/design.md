# Design — web_embedding

## 1. Tabla (migración `0027_web_embedding.sql`)
`tenant_dominio`: id, tenant_id FK, dominio (text, UNIQUE por tenant),
paquete_web CHECK ('portal_inquilino','portal_propietario','web_completo'),
logo_url, colores_json, activo, created_at. RLS ENABLE+FORCE.

## 2. Rutas (2)
| Método y ruta | Rol | R |
|---|---|---|
| POST /portal/sso | público (token firmado) | R2, R5 |
| GET /portal/config?dominio= | público (solo datos públicos del tenant) | R4 |

## 3. Handshake (R2, PA-32-2)
El contexto externo (WordPress) firma un token `{dominio, rol, sub}` con
expiración 5 min y `jti` de un solo uso (tabla `portal_sso_usado` o la
sesión ya existente); `POST /portal/sso` lo valida (rol declarado vs
`tenant_dominio.paquete_web`), abre una sesión #27 y devuelve access+
refresh.

## 4. CORS por tenant (R3, PA-32-3)
El `buildCorsOptions` actual (lista global) se sustituye por un middleware
que resuelve el tenant por `Origin` contra `tenant_dominio` y aplica su
lista; si el origen no está registrado → sin cabeceras CORS (bloqueado).

## 5. Archivos
Migración 0027, schema tenant-dominio.ts, tipos, `modules/core/portal/`
(portal.{service,controller}.ts + middleware CORS por tenant), bundle
`apps/web/src/portal/` (web component con Shadow DOM + theming), tests
(handshake válido/inválido/reusado, CORS por tenant, feature flag,
seguridad).
