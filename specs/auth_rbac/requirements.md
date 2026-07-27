# Requisitos — auth_rbac

> Feature #3. Autenticación, identidad multi-rol y RBAC.
> Anclaje: RF-AU1, RF-C2, RF-C3, RF-AU6 del PRD.

---

## ENMIENDA 2 (2026-07-27) — identidad por tenant y login por inmobiliaria (D-8, #5)

> Segunda enmienda, posterior a la de más abajo. Origen: **decisión D-8** del
> humano en `specs/owner_tenant_profiles/` — *nunca se vinculan identidades
> entre tenants*. Afecta a **R1, R2, R3 y R4** de esta feature.

**Qué cambia.**

| Elemento | Original de #3 | Estado tras #5 (D-8) |
|---|---|---|
| `user.tenant_id` | no existe (`user` era global) | `uuid NOT NULL` FK → `tenant(id)` |
| Unicidad del correo | `UNIQUE (email)` global | `UNIQUE (tenant_id, email)` — los NULL siguen conviviendo |
| `user_role` | FK simple a `user(id)` | FK **compuesta** `(user_id, tenant_id)`: el rol no puede apuntar a otro tenant que el de su identidad |
| Política RLS de `user` | `FOR ALL USING (id IN (SELECT user_id FROM user_role …))`, sin `WITH CHECK` | Política estándar del proyecto: `tenant_id = current_setting('app.current_tenant', true)::uuid` en `USING` y en `WITH CHECK` |
| `POST /auth/login` (R3) | `{ email, password }` | `{ nit, email, password }` — **400** si falta el `nit`; 401 uniforme si el correo es de otro tenant o el `nit` no existe |
| JWT (R4) | `roles: [{tenant_id, rol}]` de **varios** tenants | roles de **un solo** tenant: una identidad pertenece a una única inmobiliaria |
| Consulta del login | `pool.query` sin contexto de tenant | dentro de transacción, con `SET LOCAL app.current_tenant`, **bajo RLS** |

**Motivo (D-8).** La política `FOR ALL` sin `WITH CHECK` de esta feature
contradecía el modelo de identidad de #5: con un rol sujeto a RLS impedía crear
identidades (bloqueo circular con la FK de `user_role`) y dejaba el login
devolviendo 401 a todo el mundo. El humano resolvió la contradicción por el lado
del producto: si ninguna identidad se comparte entre inmobiliarias, `user` es una
tabla de negocio normal y le aplica la política estándar. El coste es que el
correo deja de identificar a una persona y el login necesita saber la
inmobiliaria.

**Qué NO cambia.** R5 (`JwtAuthGuard`), R7 (`RolesGuard`) y R8 (protección de
endpoints) siguen vigentes tal cual. El `RolesGuard` sigue rechazando con 403
cualquier `x-tenant-id` que no coincida con el token (#5 R33).

**Dónde está el detalle:** `specs/owner_tenant_profiles/requirements.md` grupo M
(R59–R67) y `design.md` §20.1, §20.2 y §20.4 (qué parte de RF-AU6 queda cubierta
y cuál no).

---

## ENMIENDA (2026-07-27) — R1 superado por R7 de la feature #5

> Esta feature está `done`. Su **R1 queda parcialmente superado** por la
> feature #5 `owner_tenant_profiles` (R6 y R7), implementada el 2026-07-27.
> Se registra aquí —igual que `docs/conventions.md` se enmendó tras la
> feature #1— para que el estado del repositorio no quede contradictorio: el
> esquema real ya no cumple el R1 tal como está escrito más abajo.

**Qué cambia.** En la tabla `user`:

| Columna | R1 de #3 (original) | Estado real desde #5 |
|---|---|---|
| `email` | `text NOT NULL UNIQUE` | `text UNIQUE` — **NULL-able** |
| `password_hash` | `text NOT NULL` | `text` — **NULL-able** |

**Motivo (decisión del humano D-5, `specs/owner_tenant_profiles/requirements.md`).**
Hay propietarios reales sin correo electrónico; exigirlo produce datos falsos
inventados por el operador. Y un cliente registrado por la inmobiliaria
(RF-C1) todavía no tiene credenciales de portal, así que `password_hash` no
puede ser obligatorio en el momento del alta.

**Qué NO cambia.** La restricción `UNIQUE` sobre `email` se conserva intacta:
PostgreSQL trata cada NULL como distinto, así que varias identidades sin
correo conviven y **dos emails iguales no nulos siguen colisionando**
(#5 R7). No se añadió índice parcial.

**Contrapartidas obligatorias, implementadas y probadas en #5.** Relajar el
esquema sin ellas habría abierto un agujero de autenticación:

- **#5 R6** — `POST /auth/login` responde 401 si `password_hash IS NULL`, sin
  llegar a evaluar ninguna contraseña.
- **#5 R8** — `POST /auth/login` responde 401 si el `email` recibido es nulo,
  ausente o vacío, y la consulta nunca puede casar un `user` con
  `email IS NULL`.

**Consecuencia abierta para la feature del portal del cliente (RF-AU2/AU4).**
El R4 de esta feature incluye `email` en el payload del JWT. Hoy no rompe nada
—#5 no emite tokens para clientes—, pero cuando exista el portal habrá que
decidir qué identificador lleva el token de un usuario sin correo.

Migración que aplica el cambio:
`apps/api/drizzle/0005_owner_tenant_profiles.sql`.

---

## Requisitos

### R1 — Tabla `user` (RF-AU1)

> ⚠️ **Enmendado por la feature #5 (D-5).** Ver la sección ENMIENDA al inicio
> de este archivo: `email` y `password_hash` son NULL-able.

El sistema debe almacenar usuarios con:
- `id` uuid PK (gen_random_uuid)
- `email` text NOT NULL UNIQUE — *enmendado por #5 R7: **NULL-able**, la UNIQUE se conserva*
- `password_hash` text NOT NULL — *enmendado por #5 R6: **NULL-able***
- `nombre` text NOT NULL
- `telefono` text
- `created_at` timestamp NOT NULL DEFAULT now()
- `updated_at` timestamp NOT NULL DEFAULT now()

La tabla debe tener RLS habilitado con FORCE.

### R2 — Tabla `user_role` (RF-C2, RF-C3, RF-AU6)

> ⚠️ **Enmendado por #5 (D-8):** FK compuesta `(user_id, tenant_id)` hacia
> `user`. Ver ENMIENDA 2 al inicio.

El sistema debe almacenar roles de usuario por tenant con:
- `id` uuid PK (gen_random_uuid)
- `user_id` uuid NOT NULL FK → `user(id)`
- `tenant_id` uuid NOT NULL FK → `tenant(id)`
- `rol` text NOT NULL CHECK (`rol` IN ('super_admin', 'admin', 'empleado', 'propietario', 'inquilino'))
- `activo` boolean NOT NULL DEFAULT true
- `created_at` timestamp NOT NULL DEFAULT now()
- UNIQUE (`user_id`, `tenant_id`, `rol`)

La tabla debe tener RLS habilitado con FORCE. La política de RLS debe filtrar por `tenant_id = current_setting('app.current_tenant', true)::uuid`.

### R3 — Login (RF-AU1)

> ⚠️ **Enmendado por #5 (D-8):** el endpoint exige `nit` además de `email` y
> `password`. Ver ENMIENDA 2 al inicio.

El endpoint `POST /auth/login` debe:
1. Aceptar `{ email, password }`.
2. Verificar credenciales contra `password_hash` (bcrypt/argon2).
3. Retornar `{ access_token, user: { id, email, nombre } }`.
4. Retornar 401 si las credenciales son inválidas.

### R4 — JWT payload (RF-C3, RF-AU6)

> ⚠️ **Enmendado por #5 (D-8):** `roles` contiene los roles de un **único**
> tenant. Ver ENMIENDA 2 al inicio.

El token JWT debe contener:
- `sub`: user_id (uuid)
- `email`: string
- `roles`: array de `{ tenant_id, rol }` (solo roles activos)
- `iat`, `exp`

El secret JWT se configura por variable de entorno `JWT_SECRET`.

### R5 — AuthGuard (RF-C3)

Un guard NestJS `JwtAuthGuard` debe:
1. Extraer el token del header `Authorization: Bearer <token>`.
2. Validar la firma y expiración.
3. Adjuntar el payload decodificado a `request.user`.
4. Retornar 401 si el token es inválido o ausente.

### R6 — TenantContextInterceptor actualizado (RF-C3, RF-AU6)

El `TenantContextInterceptor` existente debe actualizarse para:
1. Extraer `tenant_id` del JWT (`request.user.roles[0].tenant_id` o header `x-tenant-id` como fallback).
2. Ejecutar `SET LOCAL app.current_tenant` con el `tenant_id` del token.
3. El endpoint `POST /auth/login` NO debe ser protegido por este interceptor.

### R7 — RolesGuard (RF-C3)

Un guard NestJS `RolesGuard` debe:
1. Leer los roles del usuario desde `request.user.roles`.
2. Verificar que el usuario tiene al menos un rol activo para el tenant actual.
3. Soportar decorador `@Roles('admin', 'empleado')` para filtrar por rol específico.
4. Retornar 403 si el usuario no tiene el rol requerido.

### R8 — Protección de endpoints (RF-C3)

Los endpoints de negocio (futuros) deben usar `@UseGuards(JwtAuthGuard, RolesGuard)`. Para esta feature, se crea un endpoint de ejemplo `GET /auth/me` protegido que retorna el perfil del usuario autenticado.

### R9 — Tests de login (RF-AU1)

Tests contra Testcontainers (PostgreSQL real):
- Login exitoso retorna access_token con estructura correcta.
- Login con contraseña incorrecta retorna 401.
- Login con email inexistente retorna 401.

### R10 — Tests de RBAC (RF-C3)

Tests contra Testcontainers (PostgreSQL real):
- Usuario con rol 'admin' en tenant A accede a endpoint protegido del tenant A.
- Usuario con rol 'empleado' en tenant A NO accede a endpoint que requiere 'admin'.
- Token de tenant A NO accede a recursos de tenant B (aislamiento).
- Sin token, el endpoint retorna 401.

### R11 — Migración conjunta

Las tablas `user` y `user_role` se crean en una única migración `0003_auth_rbac.sql` que también:
- Habilita RLS en ambas tablas.
- Crea la política de RLS para `user_role` (filtrar por tenant_id).
- Crea la política de RLS para `user` (acceso solo por user_role del tenant actual).

### R12 — Exportaciones

`apps/api/src/database/schema/index.ts` debe exportar los esquemas de `user` y `user_role`.
`tests/migrations.test.ts` debe incluir `'user'` y `'user_role'` en `TABLAS_PERMITIDAS`.
