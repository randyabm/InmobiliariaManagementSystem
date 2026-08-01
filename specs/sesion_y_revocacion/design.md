# Design — sesion_y_revocacion

> Feature #27. Sesiones, refresh tokens y revocación inmediata.
> Cierra **PA-3** (ventana entre revocar un rol y que expire el token).
> Este documento asume `docs/architecture.md` y `docs/conventions.md`; solo
> documenta los puntos donde la feature roza sus fronteras.

---

## 1. El problema y por qué este diseño

Hoy el JWT es **estadeless**: los claims congelan el estado en el momento de
la emisión. Un JWT no tiene "revocación" porque nadie puede invalidar un dato
firmado; solo se puede (a) esperar a que expire o (b) comprobar contra un
estado vivo en cada petición. PA-3 rechazó (a). Este diseño adopta (b) con el
estado más pequeño posible: **una sesión por login** y **una versión por
identidad**.

```
access token = claims firmados (sub, tenant_id, roles, rol_activo, jti, ver)
                           └── jti: id de la sesión  (R3)
                           └── ver: user.token_version (R3)
cada petición:  JwtStrategy (firma+exp)  →  SesionesRepository.validarAcceso(jti, ver)
                              └── una consulta, dentro de SET LOCAL app.current_tenant
revocar sesión  →  sesion.revocada_at = now()          → 401 en la siguiente petición
revocar un rol  →  user_role.activo=false + ver++       → 401 en la siguiente petición
```

**Coste asumido:** una consulta a la base por petición autenticada. Es el
precio inevitable de la revocación inmediata con tokens sin estado; las
alternativas (lista negra en Redis, sesiones en memoria) se descartan en §3.

## 2. Qué se construye

```
modules/core/auth/
├── sesiones.repository.ts        # único acceso a "sesion" + token_version
├── sesiones.service.ts           # abrir, validar, rotar, revocar, reuso
├── auth.service.ts               # login crea sesión; refresh/logout delegan
├── jwt.strategy.ts               # validate() pasa a async: valida sesión (R4, R5)
├── auth.controller.ts            # + POST /auth/refresh, POST /auth/logout
└── errors/sesion-invalida.error.ts  # 401 uniforme (R9)
```

Nada nuevo fuera de `auth/`: `sesion` es una tabla de la feature #3 (migrada
en #27), `audit_log` ya existe, y el contexto de tenant ya es global.

## 3. Alternativas descartadas (y por qué)

1. **Lista negra de tokens en Redis.** Descarta: el proyecto no usa Redis en
   código todavía (solo está en `docker-compose`), y una lista negra de
   tokens crece sin cota ni semántica ("¿cuándo puedo borrar esta entrada?").
   Una sesión tiene ciclo de vida explícito y un `expira_en` natural.
2. **Re-validar `user_role` en cada petición.** Descarta: son N filas por
   petición y un problema de consistencia (¿qué pasa si el rol se revoca a
   mitad de petición?). `token_version` resume "algo cambió" en un entero y
   una sola fila; el token siguiente —vía refresh o re-login— ya lleva los
   roles nuevos leídos de la base (R12).
3. **Expiraciones cortas sin revocación.** Es la variante que el humano ya
   rechazó en PA-3: "resolverlo de verdad" significa que la revocación surte
   efecto en la **siguiente petición**, no en la próxima expiración.
4. **Tirar la sesión a `user` (una columna `session_id`).** Descarta: una
   identidad puede tener varias sesiones (dos dispositivos), y el refresh
   token rotado necesita una huella por sesión (R8).

## 4. Migración (`0011_sesion_y_revocacion.sql`, R20)

Forward-only e idempotente. Contenido:

1. `CREATE TABLE IF NOT EXISTS sesion (...)` — **R1**, con
   `UNIQUE (refresh_token_hash)` parcial (`WHERE refresh_token_hash IS NOT
   NULL`), índice `(user_id, tenant_id)` y CHECK de coherencia
   (`(revocada_at IS NULL) = (motivo_revocacion IS NULL)`).
2. `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS token_version integer NOT
   NULL DEFAULT 0` — **R2**.
3. RLS en `sesion`: `ENABLE` + `FORCE` + política `sesion_tenant_isolation`
   por `tenant_id` (patrón `0005`), en la misma migración (R1).
4. Función `sesion_por_refresh_token(p_hash text) RETURNS TABLE(id uuid,
   user_id uuid, tenant_id uuid, expira_en timestamptz, revocada_at
   timestamptz)` — `LANGUAGE sql STABLE SECURITY DEFINER SET search_path =
   public, pg_temp`, con `REVOKE ALL ON FUNCTION ... FROM PUBLIC` — **R18**,
   patrón idéntico al de `tenant_por_codigo` (`0007:321-330`). Es la **segunda
   y última** vía de lectura fuera del RLS del sistema, y solo devuelve el
   bootstrap mínimo para fijar contexto.
5. Comentarios `COMMENT ON` con el `R<n>` y el motivo (convención del repo).

**La migración NO toca `audit_log`, ni `user_role`, ni `roles.guard.ts`.**

## 5. El hash del refresh token (R10)

`refresh_token` en claro = `randomBytes(48).toString('base64url')` (48 bytes
≈ 384 bits de entropía, nunca predecible). En la base solo vive
`sha256(en claro)` en hex. La comparación en `sesion_por_refresh_token` es
por **coincidencia exacta de hash** — nunca `LIKE`, nunca substring, que
convertiría la función en un enumerador de sesiones (el mismo criterio de
`tenant_por_codigo`, R52).

## 6. Flujo de validación por petición (R4, R5)

`JwtStrategy.validate(payload)` pasa a `async`:

```
1. si payload.jti o payload.ver no existen         → 401 (R5)
2. cliente = pool; BEGIN; SET LOCAL tenant_id (del token)
3. SELECT s.*, u.token_version
     FROM sesion s JOIN "user" u ON u.id = s.user_id
    WHERE s.id = $jti
   → 0 filas            → 401
   → revocada_at ≠ NULL → 401
   → expira_en ≤ now()  → 401
   → token_version ≠ ver → 401   (mismo cuerpo en todos los casos)
4. COMMIT; devolver payload
```

Corre en el **strategy** (un solo punto, antes de `RolesGuard` y de los
interceptores), por la lección de la sesión anterior: la regla de
autorización vive en un solo sitio o acaba divergiendo. Un 401 de sesión es
un fallo de autenticación, no de autorización; `RolesGuard` no se toca
(R15).

## 7. Login, refresh y logout

### Login (R6) — `POST /auth/login`

Sin cambios en la autenticación (bcrypt, un solo 401, RLS). Después:

```
1. INSERT sesion (user_id, tenant_id, refresh_token_hash = sha256(refresh),
                  expira_en = now() + REFRESH_TOKEN_EXPIRATION, ...)
2. payload = { sub, email, tenant_id, roles, jti: sesion.id, ver: user.token_version }
3. respuesta 200: { access_token, refresh_token, expires_in, user }
```

`refresh_token` se genera y se **devuelve una sola vez**; el hash se guarda.
Duración por defecto: `REFRESH_TOKEN_EXPIRATION` (segundos, default
2.592.000 = 30 días) — env nueva, estilo `JWT_EXPIRATION` ya existente.

### Refresh (R7, R8, R9, R18, R19) — `POST /auth/refresh` (público)

```
1. hash = sha256(refresh recibido)
2. sesion_por_refresh_token(hash) → (id, user_id, tenant_id, expira_en, revocada_at)
   → 0 filas       → 401 uniforme (R9)
   → revocada/expirada → 401 uniforme (R9)
3. BEGIN; SET LOCAL tenant_id   (R19)
4. re-leer la sesión DENTRO del RLS → debe seguir viva y coincidir
5. reuso: si el hash recibido == refresh_token_hash_anterior
      → revocar sesión (motivo 'refresh_token_reutilizado') + auditoría (R13)
      → 401
6. rotar: hash_anterior = hash actual; hash = sha256(refresh nuevo);
   last_used_at = now()
7. payload nuevo (ver actual, roles nuevos de la base); 200 { access_token, refresh_token }
```

El paso 2 es la única vía previa al tenant (R18); el paso 4 revalida dentro
del RLS para que la función SECURITY DEFINER no sea la única barrera (R19).

### Logout (R11, R13) — `POST /auth/logout` (JwtAuthGuard)

```
1. jti = request.user.jti; BEGIN; SET LOCAL
2. UPDATE sesion SET revocada_at = now(), motivo = 'cierre_de_sesion' WHERE id = $jti
3. auditar auth.sesion_cerrada (actor del token, entity_id = sesion, metadata {motivo})
```

## 8. Revocación de un rol (R12) — mecanismo, no interfaz

No existe hoy ningún endpoint de administración de roles (ni lo pide el
PRD), así que la operación que **dispara** la revocación no es de esta
feature. Lo que #27 garantiza es el **efecto**:

```
UPDATE user_role SET activo = false WHERE ...
UPDATE "user" SET token_version = token_version + 1 WHERE id = ...
   ↑ misma transacción: no existe el instante en que el rol está revocado
     y la versión no ha subido.
```

El test determinista de la aceptación hace exactamente esas dos sentencias
contra PostgreSQL real y demuestra que la siguiente petición con el token ya
emitido es 401. La auditoría de la *operación* "revocar rol" (actor, motivo)
llegará con la feature de administración de usuarios/roles; aquí la
revocación auditada es la de **sesiones** (R13): apertura, refresh, cierre y
reuso.

## 9. Auditoría (R13, R17)

| `accion` | `entityType` | `entityId` | `metadata` |
|---|---|---|---|
| `auth.sesion_abierta` (login) | `sesion` | id de la sesión | `{}` |
| `auth.refresh_emitido` | `sesion` | id de la sesión | `{}` |
| `auth.sesion_cerrada` (logout) | `sesion` | id de la sesión | `{ motivo: 'cierre_de_sesion' }` |
| `auth.sesion_revocada_por_reuso` | `sesion` | id de la sesión | `{ motivo: 'refresh_token_reutilizado' }` |

`metadata` nunca lleva tokens, hashes ni PII (R10, R17). El actor del login
se conoce (es el usuario autenticado); el de las demás, del token. El
`AuditService` no se toca.

## 10. Errores de dominio

| Error | `code` | HTTP | Cuándo |
|---|---|---|---|
| `SesionInvalidaError` (nuevo) | `SESION_INVALIDA` | 401 | R4, R5, R9: sesión inexistente, sin `jti`, revocada, expirada, `ver` viejo o refresh no casado — **un solo cuerpo** |

`AllExceptionsFilter` ya traduce `AppError` con `status < 500` a su mensaje,
así que no se toca. Los 401 del login (`UnauthorizedException`) no cambian.

## 11. Archivos

### Se crean

```
apps/api/drizzle/0011_sesion_y_revocacion.sql      (siguiente índice libre)
apps/api/src/database/schema/sesion.ts
apps/api/src/modules/core/auth/sesiones.repository.ts
apps/api/src/modules/core/auth/sesiones.service.ts
apps/api/src/modules/core/auth/errors/sesion-invalida.error.ts
apps/api/src/modules/core/auth/__tests__/sesiones.api.test.ts
apps/api/src/modules/core/auth/__tests__/sesiones.service.test.ts
apps/api/src/database/__tests__/sesiones-rls.test.ts
```

### Se modifican

```
apps/api/src/database/schema/user.ts                (tokenVersion, R2)
apps/api/src/database/schema/index.ts               (exportar sesion)
apps/api/src/modules/core/auth/auth.service.ts      (login crea sesión; refresh/logout)
apps/api/src/modules/core/auth/auth.controller.ts   (+2 rutas)
apps/api/src/modules/core/auth/jwt.strategy.ts      (validate async, R4/R5)
apps/api/src/modules/core/auth/auth.module.ts       (registrar repository/service)
apps/api/drizzle/meta/_journal.json                 (entrada nueva)
tests/migrations.test.ts                            (TABLAS_PERMITIDAS + 'sesion')
apps/api/src/modules/core/__tests__/routes-surface.test.ts (RUTAS_PERMITIDAS +2)
apps/api/test/db/migrations.db.test.ts              (sesion, token_version, función)
apps/api/test/support/entorno-clientes.ts           (sembrar sesiones + firmar con jti/ver)
apps/api/src/modules/core/auth/__tests__/rol-activo.api.test.ts   (arnés jti/ver)
apps/api/src/database/__tests__/auth-rbac.test.ts   (arnés jti/ver)
feature_list.json                                   (#27 → spec_ready)
```

## 12. Decisiones técnicas que el humano confirma en la puerta del spec

| Id | Decisión | Alternativa | Recomendación |
|---|---|---|---|
| **PA-27-1** | Todo access token sin `jti`/`ver` → 401 (R5). Se invalidan los tokens fabricados o emitidos antes de esta feature | Mantener compatibilidad: tokens sin `jti` pasan sin validar (reabre PA-3) | **Exigir `jti`/`ver`** — no hay producción, y un token sin sesión es un token no revocable |
| **PA-27-2** | La revocación de rol queda como mecanismo probado por test con mutación directa a la base; sin endpoint y sin auditoría de actor hasta que exista la feature de administración de roles | Añadir ya un endpoint `admin` de revocación de roles | **Sin endpoint** — el PRD no tiene RF-* de administración de usuarios; inventar uno sería inventar producto |
| **PA-27-3** | Duración del refresh: 30 días por defecto, configurable por env; access sigue en 1 hora (valor existente) | Refresh sin expiración | **30 días** — cota la vida de un credencial rotable |
| **PA-27-4** | Reuso de un refresh rotado → se revoca la sesión completa (R8) | Reuso → solo 401, sin revocar | **Revocar la sesión** — es el comportamiento estándar contra fugas (RFC 6749 §10.4) |

## 13. Estado de las ambigüedades

El PRD no define sesiones, refresh ni logout (no hay RF-* dedicado): el
alcance lo fijan los criterios de aceptación que el humano escribió al crear
la feature y PA-3. Las cuatro decisiones técnicas de §12 se dejan explícitas
para la puerta del spec. No queda ninguna pregunta de producto abierta.
