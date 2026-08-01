# Review — feature #10 (`notifications`)

**Veredicto:** APPROVED

Revisor: agente `reviewer`. Fecha: 2026-08-01. HEAD revisado: `3fac323`.
Árbol de trabajo limpio antes y después de la revisión (`git status --short`
final vacío).

Línea base ejecutada por el leader: `./init.sh` exit 0, `test` **706** (76
archivos), `test:db` **116** (3 archivos), lint, typecheck y build verdes.
Además ejecuté la línea base de los 6 archivos nuevos de la feature:
**32/32 verdes**.

---

## 1. Verificación por mutación

Ejecuté **cinco** mutaciones, correspondientes a los puntos de riesgo del
informe del implementer.

| # | Mutación | Suite | Rojos | ¿Coincide con el informe? |
|---|---|---|---|---|
| 1 | quitar el gancho en `WorkflowService.registrar` | `gancho-api.test.ts` | **1 / 4** | ✅ (T7: «una transición con hook escribe la fila del outbox») |
| 2 | procesador sin `SET LOCAL` del tenant de la fila | `procesador.test.ts` | **3 / 3** | ✅ (todo el despacho muere: el RLS oculta las filas) |
| 3 | reintentos sin `FALLIDA` definitiva (siempre PENDIENTE) | `procesador.test.ts` | **1 / 3** | ✅ («intentos acotados»: el tope de 3 es carga real) |
| 4 | resolver con canal fijo `CORREO` (ignora el medio preferido) | `resolver-destinatario.test.ts` | **1 / 6** | ✅ (RF-C4: «WHATSAPP» esperado) |
| 5 | quitar los triggers append-only de `notificacion_enviada` | `migrations.db.test.ts` | **1 / 94** | ✅ («append-only incluso para el dueño») |

Rojos concretos:

- **(1)** → T7: sin el gancho, la transición con hook no deja outbox. La
  pieza que conecta el motor con las notificaciones es carga real.
- **(2)** → los tres tests del procesador: sin `SET LOCAL`, el RLS oculta
  TODO el outbox y las programadas — el aislamiento por tenant del
  procesador no es cosmético, es la condición de funcionamiento.
- **(3)** → T11: «una fila sin destinatario falla con intentos acotados»:
  sin el tope, la fila nunca llega a `FALLIDA` definitiva.
- **(4)** → T22: el `medio_preferido_contacto` (RF-C4) se respeta.
- **(5)** → la inmutabilidad de `notificacion_enviada` la impone el motor,
  no la disciplina del servicio.

## 2. Trazabilidad requirements ↔ tests (18/18)

Verificada archivo por archivo; la tabla del implementer
(`progress/impl_notifications.md`) es fiel. R1–R18 [x], con mutación que
los sostiene en los puntos de riesgo (R2 → mut. 1, R3/R14 → mut. 2, R4 →
mut. 3, R7 → mut. 4, R6 → mut. 5).

**Anclaje al PRD:** los 18 citan RF-N1, RF-N2, RF-W3, RF-C4, RF-W4, §11,
D2, §6.4. Ningún requirement sin origen.

**Ningún test fabrica el objeto que dice verificar.** El procesador se
ejercita contra PostgreSQL real (Testcontainers) con el rol de aplicación;
el gancho se prueba por el motor real (#7); las aserciones de estado usan
`SELECT` independientes (outbox, enviadas, programadas); el único doble del
unit (resolver) registra llamadas.

## 3. Puntos críticos revisados

1. **El outbox transaccional (PA-10-1) es real.** T7 lo demuestra en las
   dos direcciones: la fila nace con la transición y, si la condición
   falla, no queda nada (rollback incluido). BullMQ no podría dar esto; la
   decisión de la puerta queda validada.
2. **El procesador global respeta el aislamiento (R14).** La tercera vía
   fuera del RLS (`notificaciones_tenants_a_procesar`, patrón R52/R18)
   devuelve SOLO los tenant_id con trabajo; todo lo demás ocurre dentro de
   `SET LOCAL` de cada tenant (mut. 2: sin él, el procesador no ve nada —
   el RLS es la barrera y el bootstrap solo el arranque).
3. **El inventario SECURITY DEFINER creció a tres** y el test que lo vigila
   se actualizó explícitamente: cada vía nueva queda auditada, no
   silenciosa.
4. **La semántica del motor no cambia (R18).** T21: transición con hook =
   mismo estado, mismo log, sin filas extra. El gancho está en un solo
   punto (`registrar`), que es también el del log de dominio.
5. **El hook llega a la base.** `esquemaAnadirTransicion` + `insertarTransicion`
   ahora persisten `notificacion` (el test del gancho lo cazó: la
   transición añadida perdía el hook). La mutación 1 confirma que el
   consumo es real.
6. **Frontera #8 respetada y ajustada.** El test T20 de #8 se actualizó de
   «no existen tablas de notificación» a «la transición del seed sin hook
   no genera trabajo» — la propiedad (R8 de #8) se mantiene; el inventario
   de tablas es ahora de #10 (R17).

## 4. Tasks completas

**25 / 25 `[x]`** en `specs/notifications/tasks.md`.

## 5. Invariantes de seguridad (C7)

- **Aislamiento por tenant:** [x] — RLS real en las tres tablas (T17,
  virgen → 0 filas) + procesador por `SET LOCAL` (mut. 2) + HTTP T18.
- **RBAC en backend con test de rechazo:** [x] — T19: 403 en las 5 rutas
  para `propietario`/`inquilino`, 201 para `empleado`, 401 sin token.
- **Auditoría de acciones críticas:** [x] — `@Audit` en las mutaciones +
  `notificacion_enviada` append-only (mut. 5 lo sostiene).
- **Sin secretos hardcodeados:** [x] — sin secretos nuevos.
- **Datos personales en logs:** [x] — T20 (auditoría serializada + logs
  capturados) y el error del outbox sin contenido (T11).
- **Integridad documental (SHA-256):** n/a — no toca documentos.

## 6. Checkpoints

C1 [x] · C2 [x] · C3 [x] · C4 [x] · C5 [x] · C6 [x] · C7 [x] · C8 n/a

---

## Bloqueantes

**Ninguno.**

## Deuda anotada (no bloqueante)

- **D-1 —** El procesador corre con un `setInterval` en el proceso de la
  API (60 s). Si el volumen o el multi-instance lo exigen, se mueve a un
  worker BullMQ leyendo la MISMA tabla (PA-10-1, anotado en el design).
- **D-2 —** `ProveedorRegistro` escribe canal `CORREO` fijo en
  `notificacion_enviada` (el canal resuelto no se propaga al proveedor).
  Es cosmético para el registro MVP pero debe propagarse cuando existan
  proveedores reales.
- **D-3 —** Los recordatorios específicos («inquilino no revisó el
  inventario en X días») los creará #13 sobre `notificacion_programada`:
  la frontera R13 queda registrada.

## Recomendación

**Cerrar #10 como `done`.** Cierra el RF-W3 de punta a punta: el hook que
#7 dejó como dato se consume transaccionalmente (outbox, PA-10-1), el
procesador global respeta el aislamiento por tenant (mut. 2 lo demuestra de
forma dramática: sin `SET LOCAL` no despacha nada), los reintentos y la
inmutabilidad del registro están en el motor (muts. 3 y 5), y el
destinatario respeta el medio preferido de RF-C4 (mut. 4). La tercera vía
fuera del RLS queda declarada y vigilada, y el test de #8 se ajustó sin
perder su propiedad. Las cinco mutaciones se reproducen al test exacto.
