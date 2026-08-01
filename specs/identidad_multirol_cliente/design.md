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
sin camino de salida.

### Esta decisión caduca (PA-2 resuelta, 2026-08-01)

**Decisión del humano:** no se fusiona nada. No hay datos reales todavía; la
migración avisa con el conteo, el invariante R6 rige hacia adelante y los datos
de prueba con duplicados **se recrean**.

**Es válida solo mientras no haya producción.** Si el sistema llega a producción
con identidades duplicadas, hará falta una **herramienta de fusión con criterio**
—qué credencial sobrevive, qué pasa con la auditoría ya escrita a nombre de la
identidad que desaparece, y con los contratos firmados que la referencian— y eso
es **feature propia**, no un apéndice de esta migración. Quien reabra este punto
debe empezar por ahí.

---

## 4. Módulos y archivos

### 4.1 `core/clientes` — deduplicación

| Archivo | Cambio |
|---|---|
| `identidad.service.ts` | `crearIdentidad` → **`resolverIdentidad`**. Nueva firma (§5). Se **elimina** `buscarEnEsteTenant` por email (**R11**, cierra D5) y se sustituye por `buscarPorDocumentoEnEsteTenant`. El `INSERT` incluye `tipo_documento`/`documento`. `asegurarRol` se conserva tal cual (ya es idempotente por `ON CONFLICT`). Nueva función pura exportada `nombresCoinciden(a, b)` (**R27**) y rechazo con 409 antes de tocar `user_role` (**R9**). |
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
| `roles.guard.ts` | **Único punto donde se aplica R18/R20/R29.** Ver §6. |
| `errors/rol-no-disponible.error.ts` | Nuevo error de dominio → 403 (R17, R29). |
| `clientes/errors/nombre-no-coincide.error.ts` | Nuevo error de dominio → 409 (R9, R28). |
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
// Lanza NombreNoCoincideConIdentidadError (409) si hay identidad con ese
// documento y `nombresCoinciden` es false (R9). El rechazo ocurre ANTES de
// insertar el user_role, así que no hay nada que deshacer.

/** Criterio de R27: trim + colapso de espacios internos + minúsculas. Nada más. */
export function nombresCoinciden(a: string, b: string): boolean;
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

## 6. Cómo restringe el rol activo (R18/R20/R29)

En `RolesGuard.canActivate`, después de resolver el tenant (código actual
intacto):

```
rolesDelTenant = roles del token con tenant_id == tenantResuelto
si el token trae rol_activo:
    si rol_activo ∉ rolesDelTenant              → 403   (coherencia, R29)
    rolesEfectivos = { rol_activo }                     (R18)
si no:
    rolesEfectivos = rolesDelTenant                     (R20)
autorizar sii  rolesEfectivos ∩ requiredRoles ≠ ∅
```

`rolesEfectivos` es siempre **subconjunto** de `rolesDelTenant`: por construcción
elegir un rol no puede autorizar nada que el conjunto completo no autorizara ya.
Esa es la propiedad que hay que poner en rojo por mutación (T27c).

**Dos comprobaciones distintas, no una a medias.** El guard solo comprueba
**coherencia interna del token** (R29): barato, sin consultar la base, e impide
que un `rol_activo` manipulado amplíe el conjunto autorizado. La comprobación
**contra la base de datos** ocurre una sola vez, en la **emisión**
(`POST /auth/rol-activo`, R19).

**Lo que esta feature NO cierra (PA-3 resuelta, 2026-08-01).** Si un rol se
revoca *después* de emitir el token, el token lo sigue concediendo hasta que
expire. El humano **no acepta** esa ventana, y la cierra la feature
**#27 `sesion_y_revocacion`** (`pending`: refresh tokens, revocación inmediata,
cierre de sesión en servidor, auditoría de la revocación). **#26 no la
implementa ni la especifica**; se limita a no empeorarla y a dejarle a #27 el
claim `rol_activo` sobre el que construir. La dependencia es explícita en ambos
sentidos: #27 depende de #26.

---

## 7. Errores de dominio

| Error | HTTP | Reutilizado / nuevo |
|---|---|---|
| `PerfilYaExisteError` | 409 | Reutilizado (#5), R7 |
| `ResourceNotFoundError` | 404 | Reutilizado (#5), R22 |
| `TenantNoAutorizadoError` | 403 | Reutilizado (#5) |
| `RolNoDisponibleError` | 403 | **Nuevo**, R17/R29. Mensaje genérico: no revela qué roles sí tiene. |
| `NombreNoCoincideConIdentidadError` | 409 | **Nuevo**, R9/R28. Cuerpo accionable, ver abajo. |

Cuerpo del 409 de R28 (`NOMBRE_NO_COINCIDE_CON_IDENTIDAD`):

```jsonc
{
  "codigo": "NOMBRE_NO_COINCIDE_CON_IDENTIDAD",
  "mensaje": "Ya existe una persona con ese documento en esta inmobiliaria, registrada con otro nombre. Corrija la ficha existente antes de continuar.",
  "user_id": "…",              // identidad existente, misma inmobiliaria
  "nombre_registrado": "…",    // el que está almacenado
  "nombre_recibido": "…"       // el que venía en la petición
}
```

Es el **único** error de esta feature que devuelve datos además del código, y es
deliberado: sin ellos, el empleado que está creando en línea (RF-C6) queda
bloqueado sin saber qué corregir. Los tres campos son de la misma inmobiliaria
(R10, R14), así que no revelan nada ajeno. **No** se incluye el documento en el
cuerpo ni en los logs (`docs/conventions.md`, Ley 1581 de 2012): quien recibe el
error acaba de teclearlo.

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

## 10. Decisiones y preguntas abiertas

### 10.1 Resueltas por el humano (2026-08-01)

| Id | Pregunta | Decisión | Dónde vive |
|---|---|---|---|
| **PA-1** | Nombre discrepante al deduplicar por documento | **409, no *first-write-wins***: el alta falla y obliga a corregir antes la ficha existente | R9 (rechazo), R28 (cuerpo accionable), R27 (criterio de comparación), §7 |
| **PA-2** | Identidades ya duplicadas en bases existentes | **No se fusiona nada.** No hay datos reales; se avisa con el conteo y se recrean los datos de prueba. **Caduca al llegar a producción** | §3 "Esta decisión caduca" |
| **PA-3** | Ventana entre revocar un rol y que expire el token | **No se acepta la ventana, y no se cierra aquí:** sale como feature propia **#27 `sesion_y_revocacion`** | R19 (frontera), §6 |

### 10.2 Abiertas

- **PA-4 (heredada, sigue abierta) — PA-14 de la #5:** quién da de alta una
  inmobiliaria y asigna su `codigo`. No la toca esta feature. No bloquea.
- **PA-5 (nueva, derivada de PA-1) — Hasta dónde normaliza la comparación de
  nombres.** R27 fija lo mínimo defendible: podar y colapsar espacios, y
  minúsculas. Deliberadamente **no** resuelve dos casos que son producto, no
  técnica, y que decidirlos por mi cuenta sería inventar:
  1. **Tildes y diacríticos.** Con R27, `"Maria Perez"` **no** coincide con
     `"María Pérez"` y dispara el 409. Es lo estricto y es probablemente
     correcto (obliga a escribir bien el nombre legal), pero será la causa más
     frecuente de fricción en el alta en línea. ¿Se plegan los diacríticos para
     comparar?
  2. **Orden de apellidos y nombres compuestos.** `"Pérez Gómez, María"` frente
     a `"María Pérez Gómez"` son la misma persona y R27 los rechaza. Resolverlo
     bien exige un modelo de nombre por partes (primer nombre / segundo nombre /
     primer apellido / segundo apellido), que hoy **no existe**: `user.nombre`
     es un texto libre. Eso es un cambio de modelo de datos, no un ajuste de
     comparación, y sería feature propia.

  **Mientras no se decida, R27 rige tal cual.** Si la respuesta a (1) es "sí,
  plegar", es un cambio de una línea en la función de normalización más su test.
  Si la respuesta a (2) es "sí, nombre por partes", **no** cabe en esta feature.

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

**31 tasks, 29 requirements, una migración sin tablas nuevas.** Es
deliberadamente menor que la #5 (73 tasks), cuya lección fue que un diff
inrevisable esconde defectos. No se propone corte adicional: los tres bloques
(deduplicación, rol activo, deuda del arnés) comparten el mismo módulo `core` y
partirlos obligaría a dos migraciones y dos rondas de review por un ahorro
marginal. Si durante la implementación el bloque B creciera más allá de lo
previsto, el corte natural es **B → feature nueva**, dejando A+D aquí: A no
depende de B en ningún punto.
