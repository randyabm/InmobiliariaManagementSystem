# Requirements — sesion_y_revocacion

> Feature #27. Sesiones, refresh tokens y revocación inmediata.
> Anclaje al PRD: **RF-AU1** (autenticación), **RF-C3** (RBAC: un rol
> revocado debe dejar de surtir efecto), **RF-AU6** (acceso segmentado por
> tenant), **RF-W4** y §11.3 (auditoría e invariantes), **D2** (RLS).
>
> **Origen:** esta feature nace de **PA-3** (decisión del humano, 2026-08-01,
> `specs/identidad_multirol_cliente/design.md` §6 y §10.1): el rol se valida
> contra la base solo en la **emisión** del token, así que si un rol se
> revoca después, el token ya emitido lo sigue concediendo hasta que expira.
> El humano **no aceptó** esa ventana ni la variante "expiraciones cortas" y
> pidió cerrarla de verdad: refresh tokens, revocación inmediata y cierre de
> sesión en servidor. Los criterios de aceptación de `feature_list.json`
> fueron definidos por el humano al crear la feature y son la autoridad de
> alcance de este spec.

Notación EARS estricta (`docs/specs.md`). Un solo `DEBE` por requirement.

## Dependencias

- **#26 `identidad_multirol_cliente` (done):** el claim `rol_activo` del JWT y
  `POST /auth/rol-activo` son el punto de extensión sobre el que esta feature
  construye (`design.md` §6 de la #26). #27 no cambia su semántica: el rol
  activo sigue restringiendo, nunca ampliando.
- **#5 `owner_tenant_profiles` (done):** contexto de tenant por petición,
  `SinContextoDeTenantError`, `AuditService`, `ResourceNotFoundError`.
- **#3 `auth_rbac` (done):** `POST /auth/login`, `JwtAuthGuard`,
  `RolesGuard`, `user_role.activo`.

---

## Grupo A — Esquema: la sesión como entidad de primer nivel

### R1 — (RF-AU1, PA-3, D2) Tabla `sesion`

EL sistema DEBE persistir cada sesión de acceso en la tabla `sesion` con, al
menos, los campos:

- `id` uuid PK DEFAULT `gen_random_uuid()` — es el `jti` del access token
- `user_id` uuid NOT NULL FK → `user(id)`
- `tenant_id` uuid NOT NULL FK → `tenant(id)`
- `refresh_token_hash` text NULL — SHA-256 del refresh token vigente
- `refresh_token_hash_anterior` text NULL — SHA-256 del refresh **rotado**, para
  detectar reuso (R8)
- `expira_en` timestamptz NOT NULL — caducidad del refresh token
- `revocada_at` timestamptz NULL — `NULL` mientras la sesión está viva
- `motivo_revocacion` text NULL
- `created_at` timestamptz NOT NULL DEFAULT now()
- `last_used_at` timestamptz NULL
- `updated_at` timestamptz NOT NULL DEFAULT now()

con RLS habilitado, forzado y política por `tenant_id` en la misma migración
que la crea. La sesión de una inmobiliaria nunca es visible desde otra (R14).

### R2 — (RF-C3, PA-3) Versión de la identidad

EL sistema DEBE mantener `user.token_version` (`integer NOT NULL DEFAULT 0`),
incrementada cada vez que se revoca un rol de esa identidad, de modo que todo
token emitido con una versión anterior quede invalidado (R12).

### R3 — (RF-AU1, PA-3) El access token declara su sesión y su versión

EL sistema DEBE incluir en el payload de todo access token emitido después de
esta feature los claims `jti` (id de la `sesion`) y `ver` (`token_version` de
la identidad), además de `sub`, `email`, `tenant_id`, `roles` y, cuando
aplique, `rol_activo`.

---

## Grupo B — Validación por petición: la revocación es inmediata o no es

### R4 — (RF-C3, PA-3) Cada petición comprueba la sesión contra la base

CUANDO una petición llega con un access token que supera la firma y la
expiración, el sistema DEBE comprobar contra la base de datos que la sesión
declarada en `jti` existe, pertenece al `tenant_id` del token, no está
revocada (`revocada_at IS NULL`) y no ha expirado su refresh, y que `ver`
coincide con `user.token_version`; SI cualquiera de esas comprobaciones
falla ENTONCES el sistema DEBE responder 401 con el mismo cuerpo para todos
los fallos.

### R5 — (PA-3, decisión técnica) Sin sesión declarada no hay acceso

CUANDO una petición llega con un access token **sin** `jti` (o sin `ver`),
el sistema DEBE rechazarla con 401, aunque la firma sea válida.

> Un token fabricado sin sesión es exactamente la puerta que PA-3 dejó
> abierta: al no haber sesión que revocar, la revocación no puede surtir
> efecto. No hay tokens emitidos en producción (el trabajo vive en un solo
> disco), así que no se mantiene compatibilidad hacia atrás.

---

## Grupo C — Login, refresh y rotación

### R6 — (RF-AU1) El login abre una sesión y entrega refresh token

CUANDO `POST /auth/login` autentica con éxito, el sistema DEBE crear una
`sesion` para esa identidad en el tenant de la petición, responder 201 (el
código que el endpoint ya usaba antes de esta feature) con
`{ access_token, refresh_token, expires_in, user }` y NO DEBE exponer el
refresh token en ninguna otra parte (ni en logs, ni en auditoría, ni en la
base en claro — R10).

### R7 — (RF-AU1) Refrescar el acceso rota el refresh token

CUANDO `POST /auth/refresh` recibe un refresh token vigente, el sistema DEBE
emitir un access token nuevo (con `ver` actual), rotar el refresh token
(moviendo el hash vigente a `refresh_token_hash_anterior` y guardando el
nuevo en `refresh_token_hash`), actualizar `last_used_at` y responder 200 con
`{ access_token, refresh_token }`.

### R8 — (RF-AU1, §11.3) El reuso de un refresh rotado revoca la sesión

SI `POST /auth/refresh` recibe un refresh token que coincide con el
`refresh_token_hash_anterior` de una sesión (es decir, alguien reutilizó un
token que ya se rotó) ENTONCES el sistema DEBE revocar la sesión completa
(`revocada_at` + motivo), registrar la revocación en auditoría (R13) y
responder 401 sin distinguir el motivo.

> La rotación con detección de reuso es la defensa estándar contra la fuga
> de refresh tokens: si un atacante y el usuario legítimo compiten por el
> mismo token, el primero en usarlo deja al segundo expuesto, y la sesión
> muere en el intento de reuso.

### R9 — (RF-AU1) Refresh inexistente, expirado o revocado es un único 401

CUANDO `POST /auth/refresh` recibe un refresh token que no casa con ninguna
sesión, o cuya sesión está expirada o revocada, el sistema DEBE responder 401
con el mismo cuerpo en los tres casos, sin revelar cuál ocurrió.

### R10 — (§11.3) El refresh token nunca se almacena ni se registra en claro

EL sistema NO DEBE almacenar en la base de datos, ni escribir en logs, ni
incluir en `audit_log.metadata`, el valor en claro de ningún refresh token:
en la base solo vive su hash SHA-256 (vigente y anterior).

---

## Grupo D — Revocación y cierre de sesión

### R11 — (RF-AU1) Cerrar sesión la invalida en el servidor

CUANDO `POST /auth/logout` recibe un access token válido, el sistema DEBE
marcar la sesión de ese token como revocada (`revocada_at` + motivo) y
responder 200; a partir de ese momento el token DEBE ser rechazado (R4), no
solo olvidado por el cliente.

### R12 — (RF-C3, PA-3) Revocar un rol invalida los tokens emitidos

CUANDO se revoca un rol de una identidad (`user_role.activo = false`) y se
incrementa su `user.token_version` en la misma transacción, el sistema DEBE
rechazar con 401 toda petición que llegue con un access token emitido antes
de ese incremento (R4, `ver` desactualizado), sin esperar a la expiración.

> El mecanismo de revocación de rol (qué operación la dispara, con qué actor
> y con qué interfaz) pertenece a la administración de usuarios/roles, que no
> tiene feature asignada en `feature_list.json` y NO es alcance de esta
> feature: aquí queda el mecanismo que hace efectiva la revocación y su
> prueba determinista (criterio de aceptación del humano). La auditoría de la
> operación "revocar rol" con su actor llegará con esa feature.

### R13 — (RF-W4, §11.3) Las acciones de sesión quedan auditadas

CUANDO se abre una sesión, se emite un refresh, se cierra una sesión o una
sesión se revoca por reuso de refresh, el sistema DEBE registrar una entrada
en `audit_log` con `tenant_id`, `actor_id`, `accion`, `entity_type =
'sesion'` y `entity_id` = id de la sesión. La revocación DEBE incluir el
motivo y el `created_at` (timestamp) de la entrada. `metadata` NO DEBE llevar
tokens, hashes ni datos personales (R10, R17).

---

## Grupo E — Invariantes de seguridad (obligatorios, `docs/specs.md`)

### R14 — (RF-A1, RF-AU6) Una sesión de una inmobiliaria nunca da acceso a otra

SI una petición con un access token (o un refresh token) emitido en el tenant
A intenta acceder a una sesión o a un recurso del tenant B ENTONCES el
sistema DEBE responder 401 (validación de sesión) o 404/403 (acceso a
recurso, como ya rige) sin revelar la existencia de la sesión ajena.

### R15 — (RF-C3) El RBAC existente sigue intacto

SI un usuario cuyo rol activo en el tenant no incluye el rol exigido invoca
un endpoint protegido ENTONCES el sistema DEBE rechazar la petición con 403
en el backend, exactamente como antes de esta feature; la validación de
sesión (R4) es adicional, no sustitutiva.

### R16 — (RF-C3, `docs/architecture.md`) Sin contexto de tenant, falla

SI un repositorio de esta feature se ejecuta sin contexto de tenant
establecido (`app.current_tenant` no fijado en la conexión) ENTONCES el
sistema DEBE fallar con `SinContextoDeTenantError` y NO DEBE consultar la
base con una conexión del pool sin `SET LOCAL`.

### R17 — (§11.3, Ley 1581 de 2012) Datos de credencial fuera de logs y auditoría

EL sistema NO DEBE incluir tokens de acceso, refresh tokens (ni en claro ni
su hash), ni datos personales de la identidad en los logs de aplicación ni
en `audit_log.metadata`.

---

## Grupo F — La única ruta previa al tenant para el refresh (patrón R52)

### R18 — (RF-AU1, R52) El refresh resuelve su tenant por función SECURITY DEFINER

CUANDO `POST /auth/refresh` recibe un refresh token, el sistema DEBE
resolver la sesión correspondiente por **coincidencia exacta del hash** a
través de una función `sesion_por_refresh_token(hash)` definida
`SECURITY DEFINER` con `REVOKE ALL FROM PUBLIC`, que devuelve únicamente
`(id, user_id, tenant_id, expira_en, revocada_at)`, y NO DEBE abrir ninguna
otra vía de lectura fuera del RLS.

### R19 — (RF-AU1, D2, defensa en profundidad) Revalidación dentro del RLS

CUANDO la función de R18 devuelve una sesión, el sistema DEBE reabrir la
lectura de esa sesión **dentro de una transacción con `SET LOCAL
app.current_tenant`** (el tenant devuelto) antes de rotar nada: si la sesión
no se confirma ahí —porque se revocó, expiró o cambió de estado entre
medias— el sistema DEBE responder 401 sin rotar.

---

## Grupo G — Gobernanza del cambio

### R20 — (D2, `docs/conventions.md`, C4/C6) Migración versionada y verificada

EL sistema DEBE aplicar todos los cambios de esquema de esta feature en una
única migración versionada, forward-only e idempotente (la siguiente libre en
`apps/api/drizzle/`, previsiblemente `0011_sesion_y_revocacion.sql`), y las
listas de control existentes (`TABLAS_PERMITIDAS` en `tests/migrations.test.ts`
y `RUTAS_PERMITIDAS` en `routes-surface.test.ts`) DEBEN actualizarse con la
tabla `sesion` y las rutas `POST /auth/refresh` y `POST /auth/logout` en el
mismo cambio.

---

## CRITERIOS DE ACEPTACIÓN del humano (feature_list.json #27)

| Criterio | R que lo satisface |
|---|---|
| Existen refresh tokens y una noción explícita de sesión, distinta del token de acceso | R1, R6, R7 |
| Revocar un rol o una sesión invalida el acceso de forma inmediata | R4, R11, R12 |
| Cerrar sesión invalida la sesión en el servidor, no solo en el cliente | R11 |
| Existe un test determinista que revoca un rol y demuestra que la siguiente petición con el token ya emitido es rechazada | R12 + test T-n del bloque 4 |
| La revocación queda auditada con actor, motivo y timestamp | R13 |
| Un token o sesión de una inmobiliaria nunca da acceso a otra | R14, R18, R19 |

**No quedan preguntas de producto abiertas.** Las decisiones técnicas que el
humano debe confirmar en la puerta del spec están en `design.md` §12.
