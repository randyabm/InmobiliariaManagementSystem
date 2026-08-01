# Review — feature #12 (`inventory_creation`)

**Veredicto:** APPROVED

Revisor: agente `reviewer`. Fecha: 2026-08-01. HEAD revisado: `2a60511`
(+1 commit del reviewer con dos tests propios). Árbol de trabajo limpio
después de la revisión.

Línea base ejecutada por el leader: `./init.sh` exit 0, `test` **761**,
`test:db` **131**, lint, typecheck y build verdes. Línea base de los
archivos de la feature: **53/53 verdes** (API + seguridad + RLS + unit).

---

## 1. Verificación por mutación

| # | Mutación | Rojos | ¿Coincide con el informe? |
|---|---|---|---|
| 1 | `buscarBorrador` sin `activo = true` | **2 / 15** | ✅ — la baja lógica debe liberar el par (propiedad, tipo_evento); sin el filtro, el borrador muerto bloquea el nuevo |
| 2 | `buscarInventarioPorId` sin `tenant_id` | **0** | Inerte por diseño: el **motor RLS** es la barrera real (rol sin `BYPASSRLS`); el `WHERE tenant_id` es la doble barrera del proyecto, no observable mientras el RLS esté activo — ver §4 |
| 3 | `exigirBorrador` sin el gate de estado | **1 / 15** | ✅ (R7: «fuera de BORRADOR la edición estructural da 409») |
| 4 | `resolverPlantillaParaTenant` ignorando la copia TENANT | **1 / 16** | ✅ (PA-12-3) — test añadido por el reviewer, ver §2 |

Rojos concretos:

- **(1)** → «un solo borrador por propiedad+tipo_evento» y «eliminar el
  borrador deja de listarse»: el borrador dado de baja sigue ocupando el
  par → 409 al crear de nuevo.
- **(3)** → «fuera de BORRADOR la edición estructural da 409 sin escribir»:
  el PATCH de ítem se aplicaba sobre un inventario ENVIADO.
- **(4)** → «la copia TENANT de la plantilla tiene prioridad sobre la
  SISTEMA»: el inventario materializaba la SISTEMA aunque existiera una
  copia TENANT editada.

## 2. Tests añadidos por el reviewer

1. **PA-12-3 (prioridad TENANT):** clona la APARTAMENTO del sistema (crea
   la copia TENANT), renombra su primera zona por la API de plantillas y
   crea un inventario nuevo: la materialización debe reflejar la copia
   TENANT (zona renombrada presente, `Sala` ausente). Sin él, la mutación 4
   era verde: la preferencia solo se observa cuando existe la copia.
2. La aserción de limpieza del borrador recién creado (el test deja el
   árbol limpio para las suites siguientes).

## 3. Trazabilidad requirements ↔ tests (11/11)

Verificada archivo por archivo; la tabla del implementer
(`progress/impl_inventory_creation.md`) es fiel. R1–R11 [x], con mutación
que los sostiene en los puntos de riesgo (R1 → mut. 1, R7 → mut. 3, R4 →
mut. 4).

**Anclaje al PRD:** los 11 citan RF-I1, RF-I3, RF-I7, RF-I24, §8.7/8.8,
RF-C3, D2. Ningún requirement sin origen.

**Ningún test fabrica el objeto que dice verificar.** Las tablas las crea la
migración 0016; el inventario y sus fotos pasan por la API real con
`SELECT` independientes (`inventario_item_foto`, `inventario_zona`, MinIO
`getObject`); el unit solo registra llamadas.

## 4. Puntos críticos revisados

1. **El patrón de RLS se reutilizó (R1-R3).** Las cuatro tablas con
   `ENABLE + FORCE` en la misma migración y política de aislamiento por
   `app.current_tenant`; el test RLS real confirma `SELECT *` sin WHERE y
   conexión virgen → 0 filas (mut. 2: la doble barrera del repositorio es
   inerte con el motor activo — aceptado, es la defensa para un despliegue
   mal configurado, patrón de todas las features).
2. **PA-12-1 (estado en columna).** El CHECK del motor lista los 7 estados
   del §8.7; el default es BORRADOR (verificado en migrations).
3. **PA-12-2 (un borrador por par).** El 409 vive en el servicio; la baja
   lógica (mut. 1) lo libera — «Nunca borrar» (rol de aplicación) se
   mantiene en cascada (`bajaLogicaCompleta`).
4. **PA-12-4 (foto: baja lógica).** La fila muere con `activo = false` y el
   objeto en MinIO se conserva (T14 verificado con `getObject` tras la
   baja).

## 5. Tasks completas

**24 / 24 `[x]`** en `specs/inventory_creation/tasks.md`.

## 6. Invariantes de seguridad (C7)

- **Aislamiento por tenant:** [x] — RLS real (T17: SELECT sin WHERE,
  virgen → 0 filas, UPDATE ajeno → 0 filas) + HTTP (T18: 404 indistinguible
  y «nada se escribió» verificado con SELECT).
- **RBAC con test de rechazo:** [x] — T19: 403 en 6 rutas para
  `propietario`/`inquilino`, 401 sin token.
- **Auditoría de acciones críticas:** [x] — T20: fila por mutación con
  `entity_id` y `metadata` vacío; el fallback `idFoto` del interceptor
  cargado.
- **Sin secretos hardcodeados:** [x] — sin secretos nuevos.
- **Datos personales en logs:** [x] — comentarios de ítems nunca en
  `audit_log.metadata` (T20).
- **Integridad documental (SHA-256):** [x] — fotos con hash verificado
  contra MinIO (T14).

## 7. Checkpoints

C1 [x] · C2 [x] · C3 [x] · C4 [x] · C5 [x] · C6 [x] · C7 [x] · C8 n/a

---

## Bloqueantes

**Ninguno.**

## Deuda anotada (no bloqueante)

- **D-1 —** La doble barrera del repositorio (`WHERE tenant_id`) no es
  observable por test mientras el RLS esté activo (mut. 2 inerte). Es el
  patrón aceptado en toda la sesión (defensa contra despliegues con
  `BYPASSRLS`); si el día de mañana se desactiva el RLS en un entorno, la
  barrera sigue en pie aunque ningún test la sostenga hoy.
- **D-2 —** `listar` hace N+1 lecturas (un `buscarCompleto` por inventario).
  Aceptable en la fase 1 (catálogos pequeños); si el listado crece, juntar
  la lectura de zonas/ítems/fotos en una sola consulta.

## Recomendación

**Cerrar #12 como `done`.** El borrador del inventario queda cerrado con
sus cuatro decisiones ejecutadas, el snapshot materializado con prioridad
TENANT ahora probada (mut. 4), y las transiciones de estado fuera de
BORRADOR bloqueadas en el borde (mut. 3). #13 tiene el contrato claro:
ENVIADO + perfil asignado + fotos con hash.
