# Review — feature #7 (`workflow_engine`)

**Veredicto:** APPROVED

Revisor: agente `reviewer`. Fecha: 2026-08-01. HEAD revisado: `ae4a3cd`.
Árbol de trabajo limpio antes y después de la revisión (`git status --short`
final vacío).

Línea base ejecutada por el leader: `./init.sh` exit 0, `test` **619** (61
archivos), `test:db` **108** (3 archivos), lint, typecheck y build verdes.
Además ejecuté la línea base de los 5 archivos nuevos de la feature
(evaluador, service, API, seguridad y RLS): **43/43 verdes**.

---

## 1. Verificación por mutación

Ejecuté **cinco** mutaciones, correspondientes a los puntos de riesgo del
informe del implementer.

| # | Mutación | Suite | Rojos | ¿Coincide con el informe? |
|---|---|---|---|---|
| 1 | evaluador fail-OPEN (operador desconocido → verdadero) | `evaluador-condiciones.test.ts` | **1 / 8** | ✅ (fail closed de R3) |
| 2a | quitar el límite de la cascada | `workflow.service.test.ts` | **cuelga** (loop infinito) | ✅ — peor que un rojo: el test de ciclo nunca termina |
| 2b | `LIMITE_CASCADA = 0` | `workflow.service.test.ts` | **1 / 6** | ✅ (la cascada normal muere) |
| 3 | `copiarDefinicion` con el join contra `$2` (el defecto real) | `workflows.api.test.ts` | **1 / 13** | ✅ (T17, el test que lo cazó) |
| 4 | política del sistema sin `IS NOT NULL` | `workflows-rls.test.ts` | **1 / 8** | ✅ (conexión virgen ve las plantillas — R15) |
| 5 | evaluar la condición con el contexto VIEJO | `workflow.service.test.ts` | **1 / 6** | ✅ (el contexto extra se fusiona antes — R7) |

Rojos concretos:

- **(1)** → «fail closed: operador desconocido, campo vacío o forma
  inválida → falso»: el fail-open convierte una condición malformada en una
  puerta abierta (R3).
- **(2a)** → el test de ciclo **se cuelga**: sin el límite, una definición
  cíclica es un bucle infinito en la transacción de la petición — peor que
  un 500. La mutación 2b lo hace determinista: con límite 0, la cascada
  legítima deja de funcionar (R8).
- **(3)** → «añadir una transición a la copia y recorrerla con cascada
  automática»: el clon que apunta a los estados del origen reaparece. El
  test de regresión del defecto real se sostiene.
- **(4)** → «en una conexión virgen, SELECT devuelve 0 filas»: sin el
  `IS NOT NULL`, `current_setting(...) → NULL` deja pasar las plantillas del
  sistema a una conexión sin contexto. El endurecimiento de PA-7-1 era
  necesario, no cosmético.
- **(5)** → «el contexto extra de la petición se fusiona ANTES de evaluar»:
  evaluar con el contexto viejo haría inalcanzable la rama condicional que
  la petición declara (R7).

## 2. Trazabilidad requirements ↔ tests (17/17)

Verificada archivo por archivo; la tabla del implementer
(`progress/impl_workflow_engine.md`) es fiel. R1–R17 [x], con mutación que
los sostiene en los puntos de riesgo (R3 → mut. 1, R8 → mut. 2, R5 → mut. 3,
R13/R15 → mut. 4, R7 → mut. 5).

**Anclaje al PRD:** los 17 citan RF-W1..W5, RF-A4, RF-P4/§12.2, D3, D2.
Ningún requirement sin origen. La aceptación «una máquina de estados
completa definida solo con datos» se demuestra sobre el seed del RF-P4
recorrido entero por HTTP (T15).

**Ningún test fabrica el objeto que dice verificar.** El seed de la máquina
lo crea la MIGRACIÓN (los tests solo lo leen); el rol de aplicación lo
provisiona `asegurarRolDeAplicacion`; las aserciones de estado persistido
usan `SELECT` independientes (`estado_actual_id`, log, `activo`); el doble
del unit solo registra llamadas.

## 3. Puntos críticos revisados

1. **La política del sistema (PA-7-1).** Tres capas verificadas: USING con
   OR (legibilidad del sistema), `WITH CHECK` propio (nadie INSERTA filas
   del sistema — probado con el rol de aplicación en `workflows-rls.test.ts`
   T5), y el `IS NOT NULL` endurecido durante la implementación (mut. 4).
   Las políticas de estado/transición también tienen `WITH CHECK` contra
   definiciones del sistema (la lección de `0003`, aplicada).
2. **El evaluador (PA-7-2).** Fail closed en las dos direcciones: el
   evaluador devuelve falso ante lo desconocido (mut. 1) y el DTO rechaza
   operadores fuera de la lista al crear transiciones. Sin `eval` ni SQL
   derivado: `grep` sobre el módulo no encuentra ninguna.
3. **Cascada atómica (PA-7-3).** Corrida en la transacción de la petición;
   sin límite, un ciclo cuelga el servidor (mut. 2a) — el límite no es una
   cortesía, es la barrera. El rollback de la petición entera lo da el
   `TenantContextInterceptor` (catchError → ROLLBACK), y el unit lo
   verifica (estado no actualizado tras el 409).
4. **El defecto real del clon.** `copiarDefinicion` apuntaba las
   transiciones a los estados del ORIGEN. Lo cazó el test de cascada sobre
   la copia (T17) y la mutación 3 confirma que la regresión no puede volver
   sin que la suite la vea. Es exactamente el patrón de defecto que esta
   sesión ha perseguido (test que ejercita el camino real).
5. **Fronteras.** RF-W3 queda como hook declarativo (`notificacion` como
   dato en la fila, sin ejecución — la #10 lo consume); RF-W2 completo y
   RF-A5 anotados para la feature de paquetes; las entidades son opacas
   para el motor (el #8 valida).

## 4. Tasks completas

**27 / 27 `[x]`** en `specs/workflow_engine/tasks.md`.

## 5. Invariantes de seguridad (C7)

- **Aislamiento por tenant:** [x] — RLS real con rol sin BYPASSRLS (T20),
  incluidas las plantillas del sistema con su régimen especial; aislamiento
  HTTP T21 (404 con SELECT «nada se escribió»); conexión virgen → 0 filas
  (mut. 4 lo sostiene).
- **RBAC en backend con test de rechazo:** [x] — T22: 403 en las 9 rutas
  para `propietario`/`inquilino`, 403 del `empleado` en la gestión
  (RF-W2), 401 sin token.
- **Auditoría de acciones críticas:** [x] — T23: una fila exacta por
  mutación (`workflow_instancia` crear/actualizar) con `tenant_id`,
  `actor_id`, `entity_type`, `entity_id`; el log de dominio append-only con
  triggers (probado incluso para el dueño en `migrations.db.test.ts`).
- **Sin secretos hardcodeados:** [x] — sin secretos nuevos; el tenant
  reservado del sistema es un identificador, no una credencial.
- **Datos personales en logs:** [x] — T24: contexto con PII distintiva
  fuera de `audit_log` (serializado completo) y de logs capturados; el log
  de dominio conserva el contexto como dato (R16).
- **Integridad documental (SHA-256):** n/a — no toca documentos.

## 6. Checkpoints

C1 [x] · C2 [x] · C3 [x] · C4 [x] · C5 [x] · C6 [x] · C7 [x] · C8 n/a

---

## Bloqueantes

**Ninguno.**

## Deuda anotada (no bloqueante)

- **D-1 —** `workflow_estado`/`workflow_transicion` no llevan `tenant_id`
  propio: su RLS es por subconsulta a `workflow_definicion`. Es correcto
  (los estados no existen sin su definición), pero un futuro revisor debe
  saber que el inventario de políticas de estas dos tablas se lee por
  subconsulta, no por columna.
- **D-2 —** El límite de cascada (10) es una constante en el servicio. Si
  un workflow real necesitara más pasos automáticos, hay que revisar la
  constante y el mensaje de `CICLO_AUTOMATICO` (¿máquina mal definida o
  límite insuficiente?).
- **D-3 —** `GET /workflows` lista también las plantillas del sistema para
  cualquier `admin`/`empleado`: es lo que permite clonar, pero el selector
  de «qué se clona» es UI del #8.

## Recomendación

**Cerrar #7 como `done`.** Es la base de todo el tablero de procesos (el #8
transiciona propiedades sobre ella, y después inventarios, contratos y
mantenimiento), y llega con el estándar de la sesión: el seed como datos
probado de punta a punta, la política del sistema con su régimen especial
verificada contra el motor, y el defecto real del clon convertido en test de
regresión. Las cinco mutaciones se reproducen al test exacto, y la 2a (el
colgado sin límite) demuestra que el límite de la cascada no es una
cortesía sino una barrera de disponibilidad.
