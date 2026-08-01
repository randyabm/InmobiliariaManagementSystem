# Design — #26 `identidad_multirol_cliente`

> Complementa `docs/architecture.md` y `docs/conventions.md`; solo documenta los
> puntos donde esta feature roza sus fronteras. Requirements en
> `./requirements.md`.

---

## 1. Idea en una frase

La **identidad** de un cliente pasa a estar identificada por su **documento
dentro de la inmobiliaria** (no por su correo, que D-9 vació), y el token puede
declarar **con cuál de sus roles actúa** la persona, restringiendo —nunca
ampliando— lo que el `RolesGuard` autoriza.

## 2. Dependencia y no-alcance

- **Depende de #5 `owner_tenant_profiles` en estado `done`.** El inventario de lo
  que se reutiliza está en `requirements.md` §0. No se monta un segundo rol de
  base de datos ni un segundo mecanismo de RLS.
- **No** se toca `perfil_propietario` ni `perfil_inquilino` en su forma actual
  (salvo lectura). **No** entra tarifa de retención, codeudores ni referencias
  (feature #25). **No** entra propiedad (feature #6).
- **No** hay frontend. Ver §9.

---

## 3. Migración `0009_identidad_por_documento.sql`

Única migración de la feature. **No crea ninguna tabla nueva**, luego no hay
política de RLS nueva que escribir: `user` ya tiene `user_tenant_isolation` con
`USING` + `WITH CHECK` y `FORCE ROW LEVEL SECURITY` desde `0007:289-297`, y esa
política **cubre automáticamente las columnas nuevas**. Se verifica en un test,
no se asume (T5).

Contenido, en este orden:

1. `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "tipo_documento" text`,
   `ADD COLUMN IF NOT EXISTS "documento" text`. **Nullable a propósito:**
   empleados y administradores se dan de alta sin documento (R6).
2. `CHECK ("tipo_documento" IN ('CC','CE','NIT','PASAPORTE'))` — el mismo dominio
   que ya usan los perfiles (`0005:43-44`), y `CHECK` de coherencia:
   `(tipo_documento IS NULL) = (documento IS NULL)`.
3. **Backfill** desde los perfiles existentes: primero `perfil_propietario`,
   después `perfil_inquilino` solo para identidades que sigan sin documento.
4. `CREATE UNIQUE INDEX ... ON "user" ("tenant_id","tipo_documento","documento")
   WHERE "documento" IS NOT NULL` → **R6**.
5. Índice de búsqueda: el propio índice único sirve; no se añade otro.

### El caso de las identidades ya duplicadas

Un entorno de desarrollo puede tener hoy dos filas de `user` para la misma
persona (propietario + inquilino), que es justo el defecto que la feature cierra.
El backfill del paso 3 **no fusiona identidades**: fusionar es una decisión de
producto (a qué credencial se queda, qué pasa con la auditoría existente) y no la
toma una migración a las 3 de la mañana. La migración:

- deja `documento` en **NULL** para la segunda fila colisionante, de modo que el
  índice parcial se puede crear sin fallar y **el invariante R6 queda vigente**
  para todo lo que se cree desde ahora;
- emite un `RAISE WARNING` con el conteo de colisiones. El diagnóstico se
  entrega como **consulta documentada** en
  `progress/impl_identidad_multirol_cliente.md`, no como un objeto de esquema
  (vista) que nadie mantendría.

**Alternativa descartada aquí:** abortar la migración ante cualquier colisión
(como hizo R61 de la #5). Se descarta porque, a diferencia de aquel caso, la
colisión **no impide** que el sistema quede correcto hacia adelante y abortar
dejaría a cualquiera que ya haya creado datos de prueba con la base bloqueada y
sin camino de salida. Queda anotado en **PA-2**.

---

## 4. Módulos y archivos

### 4.1 `core/clientes` — deduplicación

| Archivo | Cambio |
|---|---|
| `identidad.service.ts` | `crearIdentidad` → **`resolverIdentidad`**. Nueva firma (§5). Se **elimina** `buscarEnEsteTenant` por email (**R11**, cierra D5) y se sustituye por `buscarPorDocumentoEnEsteTenant`. El `INSERT` incluye `tipo_documento`/`documento`. `asegurarRol` se conserva tal cual (ya es idempotente por `ON CONFLICT`). |
| `propietarios.service.ts` | `crear` pasa `tipo_documento`/`documento` a `resolverIdentidad`; el 409 de R7 se sigue comprobando **antes** (`rechazarSiDocumentoRepetido`, intacto). Audita R13 cuando la identidad se reutilizó. |
| `inquilinos.service.ts` | Idéntico. |
| `predicado-identidad.ts` | Sin cambios; la consulta nueva usa el mismo patrón de doble barrera (**R10**). |

Ambos servicios ya comparten `IdentidadService`, así que la deduplicación entra
en **un** sitio y aplica a los dos roles. No se crea un módulo nuevo.

### 4.2 `core/auth` — rol activo

| Archivo | Cambio |
|---|---|
| `auth.controller.ts` | Nuevo `POST /auth/rol-activo`. `GET /auth/me` sin cambios de comportamiento (solo gana tests, **R15**/D3). |
| `auth.service.ts` | Nuevo `elegirRolActivo(...)`. Reutiliza `rolesActivos` y `fijarTenant` ya existentes. |
| `jwt.strategy.ts` | El payload gana `rol_activo?: string`; `validate` lo propaga sin interpretarlo. |
| `roles.guard.ts` | **Único punto donde se aplica R18/R19/R20.** Ver §6. |
| `errors/rol-no-disponible.error.ts` | Nuevo error de dominio → 403. |
| `packages/types` | `RolDeCliente` / payload del token si ya estaban expuestos; si no, no se añade nada. |

### 4.3 Arnés

| Archivo | Cambio |
|---|---|
| `init.sh:180-186` | `warn` → `fail` para `DATABASE_URL == DATABASE_MIGRATION_URL` (**R25**). |
| `specs/owner_tenant_profiles/{requirements,design}.md`, `tasks.md` | Solo **texto** del titular de R62 y del enunciado de T58 (**R26**). Las tasks siguen `[x]`; no se reabre nada. |
| `tests/` | Test de repositorio que fija R26 y test de `init.sh` para R25. |

---

## 5. Firmas nuevas

```ts
// clientes/identidad.service.ts
export interface DatosDeIdentidad {
  nombre: string;
  tipoDocumento: TipoDocumento;
  documento: string;
}

export interface IdentidadResuelta {
  userId: string;
  /** true si se reutilizó una identidad preexistente de esta inmobiliaria. */
  reutilizada: boolean;
}

resolverIdentidad(
  cliente: PoolClient,        // la transacción de la petición (R12)
  datos: DatosDeIdentidad,
  tenantId: string,
  rol: RolDeCliente,
): Promise<IdentidadResuelta>;
```

```ts
// auth/auth.service.ts
elegirRolActivo(
  userId: string,
  tenantId: string,
  rol: string,
): Promise<{ access_token: string; rol_activo: string }>;
```

```
POST /auth/rol-activo      body: { rol: 'propietario' | 'inquilino' | ... }
  200 → { access_token, rol_activo }
  403 → el solicitante no tiene ese rol activo en esa inmobiliaria (R17)
  401 → sin token
```

El payload del JWT pasa de
`{ sub, email, tenant_id, roles[] }` a
`{ sub, email, tenant_id, roles[], rol_activo? }`. **`rol_activo` es opcional**:
su ausencia es exactamente el comportamiento de hoy (**R20**), así que ningún
token emitido antes de esta feature se invalida.

---

## 6. Cómo restringe el rol activo (R18/R19/R20)

En `RolesGuard.canActivate`, después de resolver el tenant (código actual
intacto):

```
rolesDelTenant = roles del token con tenant_id == tenantResuelto
si el token trae rol_activo:
    si rol_activo ∉ rolesDelTenant              → 403   (token viejo, R19*)
    rolesEfectivos = { rol_activo }                     (R18)
si no:
    rolesEfectivos = rolesDelTenant                     (R20)
autorizar sii  rolesEfectivos ∩ requiredRoles ≠ ∅
```

`rolesEfectivos` es siempre **subconjunto** de `rolesDelTenant`: por construcción
elegir un rol no puede autorizar nada que el conjunto completo no autorizara ya.
Esa es la propiedad que hay que poner en rojo por mutación (T19).

**(\*) Matiz honesto sobre R19.** El guard compara `rol_activo` contra los roles
que trae **el propio token**, que es un dato firmado pero potencialmente viejo.
Comprobarlo contra la base de datos en cada petición sería una consulta extra en
la ruta caliente. Decisión: **R19 se cumple contra la base de datos**, con una
consulta de roles activos en `POST /auth/rol-activo` (emisión) y **expiración
corta del token** como mitigación en el resto — la revocación efectiva de roles
es un mecanismo transversal que **no existe todavía en el proyecto** y no se
inventa aquí. Ver **PA-3**.

---

## 7. Errores de dominio

| Error | HTTP | Reutilizado / nuevo |
|---|---|---|
| `PerfilYaExisteError` | 409 | Reutilizado (#5), R7 |
| `ResourceNotFoundError` | 404 | Reutilizado (#5), R22 |
| `TenantNoAutorizadoError` | 403 | Reutilizado (#5) |
| `RolNoDisponibleError` | 403 | **Nuevo**, R17. Mensaje genérico: no revela qué roles sí tiene. |

## 8. Auditoría (R13, R21)

Se usa `AuditService.log` tal cual, sin tocarlo. Dos acciones nuevas:

| `accion` | `entityType` | `entityId` | `metadata` |
|---|---|---|---|
| `identidad.rol_anadido` | `user` | `user_id` reutilizado | `{ rol }` |
| `auth.rol_activo_elegido` | `user` | `sub` | `{ rol }` |

**Nunca** se registra el `documento` en `audit_log` ni en logs
(`docs/conventions.md`, Ley 1581 de 2012). El `metadata` lleva el rol, no la PII.

## 9. Frontera con el portal del cliente (dependencia anotada, no diseñada)

El **selector visual** de "actuar como propietario / como inquilino" pertenece al
portal del cliente (RF-AU2 actualizado, RF-AU4), que **no existe como feature en
`feature_list.json`**. Esta feature le deja el contrato listo (`GET /auth/me` +
`POST /auth/rol-activo`) y **nada más**. Cuando se cree esa feature, su spec
depende de esta. Anotado también en `progress/current.md` para que el humano
decida si abre la ficha.

## 10. Preguntas abiertas (requieren decisión del humano)

- **PA-1 — Nombre divergente entre los dos perfiles.** El contacto vive en el
  perfil y puede divergir legítimamente (R8), pero el **`nombre`** es de la
  identidad y es compartido. R9 opta por *first-write-wins* silencioso. Las otras
  dos opciones son producto, no técnica: (a) responder 409 pidiendo que se
  corrija primero la ficha existente; (b) aceptar y devolver un aviso de
  divergencia en la respuesta. **No se inventa: se implementa R9 y se pregunta.**
  Si el humano prefiere (a) o (b), es un cambio acotado a `resolverIdentidad`.
- **PA-2 — Identidades ya duplicadas en bases existentes.** §3 no las fusiona.
  ¿Se quiere una herramienta de fusión (feature aparte) o basta con recrear los
  datos de prueba? Hoy no hay producción, así que la respuesta por defecto es
  "recrear".
- **PA-3 — Revocación de roles y vida del token.** R19 se cumple en la emisión;
  un rol revocado sigue siendo válido en un token ya emitido hasta que expire.
  El proyecto no tiene aún mecanismo de revocación (ni lista negra, ni refresh
  tokens). ¿Se abre una feature de sesión/revocación o se acepta la ventana?
- **PA-4 (heredada, sigue abierta) — PA-14 de la #5:** quién da de alta una
  inmobiliaria y asigna su `codigo`. No la toca esta feature.

## 11. Alternativas descartadas

### 11.1 Deduplicar consultando los perfiles, sin columna en `user` — DESCARTADA

Se podría resolver el `user_id` con un `UNION` sobre `perfil_propietario` y
`perfil_inquilino` filtrando por documento, y no tocar el esquema de `user`.

Descartada porque **deja el invariante en el código**: nada impediría que dos
filas de `user` de la misma inmobiliaria representaran a la misma persona; el
día que un tercer tipo de perfil (codeudor, #25) entre en juego, habría que
acordarse de añadirlo al `UNION`. Con la columna y el índice único parcial, el
invariante lo sostiene **el motor** (R6), que es exactamente la doctrina de
`docs/architecture.md` §Multi-tenancy: "el aislamiento lo fuerza PostgreSQL, no
el código de aplicación". El coste es una migración con backfill; el beneficio es
que R6 se puede poner en rojo con una mutación.

### 11.2 Header `x-rol-activo` en vez de claim en el token — DESCARTADA

Más simple de implementar y sin token nuevo. Descartada porque un header es un
dato **aseverado por el cliente en cada petición**: convierte "elegir rol" en algo
que se puede olvidar, falsificar o perder entre reintentos, y obligaría al guard
a validarlo contra la base en cada llamada. El claim firmado hace que el rol
elegido sea parte de la sesión y que el 403 de R17 ocurra **una vez**, en la
emisión, y no en cada endpoint.

### 11.3 Un token por rol emitido en el login — DESCARTADA

Devolver directamente N tokens en `POST /auth/login`. Descartada porque
multiplica el material de credenciales en el cliente sin ganar nada: el flujo del
PRD es "entro y luego elijo", no "entro N veces".

## 12. Dimensionamiento

**28 tasks, 26 requirements, una migración sin tablas nuevas.** Es
deliberadamente menor que la #5 (73 tasks), cuya lección fue que un diff
inrevisable esconde defectos. No se propone corte adicional: los tres bloques
(deduplicación, rol activo, deuda del arnés) comparten el mismo módulo `core` y
partirlos obligaría a dos migraciones y dos rondas de review por un ahorro
marginal. Si durante la implementación el bloque B creciera más allá de lo
previsto, el corte natural es **B → feature nueva**, dejando A+D aquí: A no
depende de B en ningún punto.
