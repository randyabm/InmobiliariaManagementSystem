# Review — feature #8 (`property_lifecycle`)

**Veredicto:** APPROVED

Revisor: agente `reviewer`. Fecha: 2026-08-01. HEAD revisado: `25460ef`.
Árbol de trabajo limpio antes y después de la revisión (`git status --short`
final vacío).

Línea base ejecutada por el leader: `./init.sh` exit 0, `test` **652** (67
archivos), `test:db` **108** (3 archivos), lint, typecheck y build verdes.
Además ejecuté la línea base de los 6 archivos nuevos de la feature:
**33/33 verdes**.

---

## 1. Verificación por mutación

Ejecuté **cinco** mutaciones, correspondientes a los puntos de riesgo del
informe del implementer.

| # | Mutación | Suite | Rojos | ¿Coincide con el informe? |
|---|---|---|---|---|
| 1 | quitar la creación de la instancia en `PropiedadesService.crear` | `ciclo-vida-vinculo.api.test.ts` | **4 / 5** | ✅ (R1, R3 y las dos direcciones de R2) |
| 2 | precedencia de la definición invertida (SISTEMA primero) | `ciclo-vida-vinculo.api.test.ts` | **1 / 5** | ✅ (T6 «con copia TENANT… cuelga de la copia») |
| 3 | quitar `extractEntityId` del `@Audit` de la ejecución | `ciclo-vida.api.test.ts` | **0** | ⚠️ ver §3 |
| 4 | *(variante honesta)* quitar el predicado `p.tenant_id` del dashboard | `ciclo-vida-seguridad.api.test.ts` | **0** | ⚠️ ver §3 |
| 5 | la envoltura acepta claves `AUTOMATICA` | `ciclo-vida.service.test.ts` | **1 / 5** | ✅ (T21: «una clave inexistente o automática es 409») |

Rojos concretos:

- **(1)** → los cuatro tests del vínculo: sin la instancia, la ficha no
  expone estado y la precedencia no tiene objeto. La aceptación R1 es carga
  real.
- **(2)** → «con copia TENANT, la instancia nueva cuelga de la copia»: la
  personalización de RF-W2 (PA-8-3) se sostiene.
- **(5)** → «una clave inexistente o automática es 409 indistinguible»: la
  envoltura no puede exponer transiciones automáticas como si fueran
  acciones humanas.

## 2. Trazabilidad requirements ↔ tests (16/16)

Verificada archivo por archivo; la tabla del implementer
(`progress/impl_property_lifecycle.md`) es fiel. R1–R16 [x], con mutación
que los sostiene en los puntos de riesgo (R1/R2/R3 → mut. 1 y 2, R5 → mut.
5, R7 → `extractEntityId` documentado, R13 → §3).

**Anclaje al PRD:** los 16 citan RF-P4, RF-P5, RF-PI4..PI6, RF-W1/W2/W3,
RF-C3, D2. Ningún requirement sin origen.

**Ningún test fabrica el objeto que dice verificar.** La máquina la siembra
la migración del motor; la instancia la crea el flujo real (`POST
/propiedades`); las aserciones de estado persistido usan `SELECT`
independientes (instancia, estado por join, log, `audit_log` con
`entity_id`); el doble del unit solo registra llamadas.

## 3. Las dos mutaciones con 0 rojos: defensa en profundidad, verificada

- **Mutación 3 (extractor de auditoría).** Con `extractEntityId` quitado,
  el fallback del interceptor cae a `params.id` — que en la ruta
  `/propiedades/:id/ciclo-vida/transiciones/:claveTransicion` ES el id de
  la propiedad. El resultado es el mismo, así que el extractor es
  **redundante hoy** pero documenta la intención (R7: `entity_id` = id de
  la PROPIEDAD, no de la máquina) y protege el día en que la ruta cambie de
  forma. Se mantiene como defensa explícita; anotado, no bloqueante.
- **Mutación 4 (predicado de tenant del dashboard).** Quitado el
  `p.tenant_id = $1` (manteniendo los parámetros alineados), el dashboard
  sigue sin filtrar propiedades de B: **el RLS del motor sostiene el
  aislamiento** (T17 lo verifica contra la base real). El predicado
  explícito es la segunda barrera que sobrevive a un despliegue mal
  configurado — el mismo patrón validado en #26 (b) y #27 (mut. 6).

## 4. Puntos críticos revisados

1. **Sin esquema nuevo (PA-8-1).** Verificado en dos direcciones: la ficha
   lee el estado del motor (join) y `information_schema` confirma que
   `propiedad` no tiene columna de estado. El dashboard es una consulta
   sobre las tablas del motor. Cero migración, cero duplicación.
2. **La envoltura no duplica al motor (PA-8-4).** `CicloVidaService`
   resuelve propiedad, instancia y clave; toda la lógica de la máquina
   (condiciones, roles, cascada, log) sigue en `WorkflowService`. El unit
   T21 verifica la delegación con los ids correctos.
3. **Auditoría con el id correcto (R7).** El log del motor (append-only) +
   `audit_log` con `entity_id` = propiedad (T13). El `contexto` no llega a
   `audit_log` ni a logs (T19).
4. **Fronteras.** R8 verificada: no existe ninguna tabla de notificaciones
   (T20) — el hook sigue siendo dato para #10. El estado `con_aseguradora`
   transiciona aquí y la póliza queda para #20.

## 5. Tasks completas

**24 / 24 `[x]`** en `specs/property_lifecycle/tasks.md`.

## 6. Invariantes de seguridad (C7)

- **Aislamiento por tenant:** [x] — RLS del motor (mut. 4 lo demuestra) +
  predicado explícito en el dashboard; T17 (404 cross-tenant con SELECT
  «nada se escribió», dashboard sin filas de B).
- **RBAC en backend con test de rechazo:** [x] — T18: 403 en las 3 rutas
  para `propietario`/`inquilino`, 200 para `empleado`, 401 sin token.
- **Auditoría de acciones críticas:** [x] — T13 (una fila exacta con
  `entity_type='propiedad'`, `entity_id` = propiedad) + el log del motor
  (R7).
- **Sin secretos hardcodeados:** [x] — sin secretos nuevos.
- **Datos personales en logs:** [x] — T19 (auditoría serializada + logs
  capturados con valores PII distintivos).
- **Integridad documental (SHA-256):** n/a — no toca documentos.

## 7. Checkpoints

C1 [x] · C2 [x] · C3 [x] · C4 [x] · C5 [x] · C6 [x] · C7 [x] · C8 n/a

---

## Bloqueantes

**Ninguno.**

## Deuda anotada (no bloqueante)

- **D-1 —** El `extractEntityId` del `@Audit` de la ejecución es hoy
  redundante con el fallback `params.id`: se mantiene como defensa
  explícita. Si alguien lo borra «porque sobra», el día que la ruta cambie
  de forma la auditoría apuntará a la máquina; el comentario del decorador
  debe conservarse.
- **D-2 —** El dashboard depende del RLS del motor para el aislamiento
  (mut. 4: 0 rojos sin el predicado). El predicado explícito es la doble
  barrera: si un día se refactoriza la consulta, mantener `p.tenant_id =
  $1` (patrón del resto del proyecto).
- **D-3 —** La propiedad sembrada a mano sin instancia (caso dev) se
  muestra sin estado y no aparece en el dashboard: el backfill real es de
  #9 o de una migración de datos cuando existan datos.

## Recomendación

**Cerrar #8 como `done`.** Cierra la frontera PA-6-3 sin añadir ni una
columna: el estado vive en el motor, la ficha y el dashboard lo leen por
join, y la envoltura de negocio no duplica ni una línea de la máquina. Las
mutaciones 1 y 2 confirman que el vínculo y la precedencia son carga real
(4/5 y 1/5 rojos), la 5 que la envoltura no expone automáticas como acciones
humanas, y las dos de 0 rojos quedan explicadas: defensa en profundidad
sostenida por el RLS y por el fallback de la ruta, ambas verificadas.
