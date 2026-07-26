# Requisitos — auth_rbac

> Feature #3. Autenticación, identidad multi-rol y RBAC.
> Anclaje: RF-AU1, RF-C2, RF-C3, RF-AU6 del PRD.

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

El endpoint `POST /auth/login` debe:
1. Aceptar `{ email, password }`.
2. Verificar credenciales contra `password_hash` (bcrypt/argon2).
3. Retornar `{ access_token, user: { id, email, nombre } }`.
4. Retornar 401 si las credenciales son inválidas.

### R4 — JWT payload (RF-C3, RF-AU6)

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
