# Review — feature #9 (`property_intake`)

**Veredicto:** APPROVED

Revisor: agente `reviewer`. Fecha: 2026-08-01. HEAD revisado: `33d0cbf`.
Árbol de trabajo limpio antes y después de la revisión (`git status --short`
final vacío).

Línea base ejecutada por el leader: `./init.sh` exit 0, `test` **674** (70
archivos), `test:db` **108** (3 archivos), lint, typecheck y build verdes.
Además ejecuté la línea base de los 3 archivos nuevos de la feature:
**22/22 verdes**.

---

## 1. Verificación por mutación

Ejecuté **cuatro** mutaciones, correspondientes a los puntos de riesgo del
informe del implementer.

| # | Mutación | Suite | Rojos | ¿Coincide con el informe? |
|---|---|---|---|---|
| 1 | reutilizar el perfil existente SIN comparar el nombre | `ingreso.api.test.ts` + `ingreso.service.test.ts` | **1 / 13** | ✅ (T11: «nombre divergente → 409 sin escribir nada») |
| 2 | crear SIEMPRE sin buscar primero | `ingreso.api.test.ts` | **3 / 8** | ✅ (reutilización de propietario e inquilino + el 409 de T11) |
| 3 | sin auditar las creaciones (R8) | `ingreso-seguridad.api.test.ts` | **1 / 9** | ✅ (T16: «entradas de cada mutación») |
| 4 | *(defensivo)* cadena con `Error` genérico en vez de 409 | `ingreso.api.test.ts` | **0** | ⚠️ ver §3 |

Rojos concretos:

- **(1)** → «propietario con el mismo documento y OTRO nombre → 409 y
  rollback total»: el criterio de PA-9-3 (nombresCoinciden, #26) es carga
  real; sin él, el ingreso consolidaría una ficha mal escrita.
- **(2)** → las dos reutilizaciones (R3/R4) y el 409 de T11: «crear si no
  existe» es un resolver con memoria, no una creación ciega.
- **(3)** → T16: el `AuditService.log` explícito del servicio (R8) es la
  única vía —el `AuditInterceptor` no ve llamadas internas— y su ausencia
  se detecta.

## 2. La mutación 4 (0 rojos): la barrera real es el motor

El 409 de la cadena bloqueada (T13) NO lo produce el `throw` defensivo del
ingreso: lo produce el **motor** (`WorkflowService.ejecutarTransicion`), que
rechaza con `TRANSICION_NO_DISPONIBLE` la transición que la copia del
tenant dio de baja (`activo = false`). El `throw` del ingreso solo cubriría
una transición que no existiera en absoluto — inalcanzable con la cadena
sembrada, que solo se desactiva, nunca se borra. Es defensa en profundidad
documentada; el comportamiento verificado (409 + rollback total) no depende
de él. Mismo patrón validado en #27 (mut. 6) y #8 (mut. 3/4).

## 3. Trazabilidad requirements ↔ tests (14/14)

Verificada archivo por archivo; la tabla del implementer
(`progress/impl_property_intake.md`) es fiel. R1–R14 [x], con mutación que
los sostiene en los puntos de riesgo (R3/R4 → mut. 1 y 2, R6 → T13, R8 →
mut. 3).

**Anclaje al PRD:** los 14 citan RF-PI1..PI3, RF-C6, RF-P4, RF-W4, RF-C3,
D2, §11.3. Ningún requirement sin origen.

**Ningún test fabrica el objeto que dice verificar.** La máquina la siembra
la migración del motor; los perfiles y la propiedad los crea el flujo real
del ingreso; las aserciones de estado usan `SELECT` independientes
(perfiles, instancia, ocupación, log del motor, `audit_log`); el doble del
unit solo registra llamadas.

## 4. Puntos críticos revisados

1. **Atomicidad real (PA-9-4).** T13: con `arrendar` desactivada en la
   copia, el ingreso B responde 409 y el rollback deja CERO filas (perfil,
   propiedad, instancia, log). La transacción de la petición lo garantiza;
   la prueba lo demuestra contra PostgreSQL real.
2. **Creación en línea con memoria (PA-9-3).** El resolver busca primero y
   compara con el criterio de #26; los 409/404 no escriben nada (T11/T12).
   Los endpoints individuales de #5 conservan su semántica de dos pasos
   (D-4): el ingreso es el único flujo con creación en línea, como
   especificó la #9.
3. **Auditoría del servicio (R8).** Cada mutación interna con su entrada y
   `entity_id` correcto; las 3 transiciones apuntan a la propiedad. Sin
   duplicación con el controller (el `@Audit` se quitó a propósito).
4. **Fronteras (R14).** Sin tablas de contratos/templates (T18); #16/#18
   extenderán el flujo cuando existan. La póliza (#20) tampoco se toca.

## 5. Tasks completas

**22 / 22 `[x]`** en `specs/property_intake/tasks.md`.

## 6. Invariantes de seguridad (C7)

- **Aislamiento por tenant:** [x] — T14: perfil de B → 404 sin escribir; el
  documento de B crea el perfil en A (SELECT: dos perfiles, uno por
  tenant). La reutilización es estrictamente intra-tenant.
- **RBAC en backend con test de rechazo:** [x] — T15: 403 para
  `propietario`/`inquilino`, 401 sin token, 201 para `empleado`.
- **Auditoría de acciones críticas:** [x] — T16 (R8) + el log del motor
  (R9, 3 filas en T10).
- **Sin secretos hardcodeados:** [x] — sin secretos nuevos.
- **Datos personales en logs:** [x] — T17 (auditoría serializada + logs
  capturados con documentos/correos distintivos).
- **Integridad documental (SHA-256):** n/a — no toca documentos.

## 7. Checkpoints

C1 [x] · C2 [x] · C3 [x] · C4 [x] · C5 [x] · C6 [x] · C7 [x] · C8 n/a

---

## Bloqueantes

**Ninguno.**

## Deuda anotada (no bloqueante)

- **D-1 —** El `throw` defensivo de la cadena (transición inexistente) es
  inalcanzable hoy (solo hay baja lógica, nunca borrado): se conserva como
  guarda contra un futuro `DELETE` físico de transiciones; su comentario
  debe mantenerse.
- **D-2 —** `ResolverPerfilService` reutiliza el PRIMER perfil que devuelve
  `buscarPorDocumento` (orden `created_at`): con datos de prueba duplicados
  de #26/PA-2 (identidades sin documento que luego se recrearon), el
  primero puede no ser el «canónico». El backfill de #26 (PA-2) caduca al
  llegar a producción; revisar si el criterio necesita orden explícito
  entonces.
- **D-3 —** El ingreso no escribe nada sobre el contrato (R14): cuando #16
  (template) y #18 (digitalización) existan, el flujo del escenario B debe
  extenderse para anexar el contrato — dependencia registrada en el spec.

## Recomendación

**Cerrar #9 como `done`.** Cierra la secuencia de ingreso del PRD §12.1
con el patrón consolidado de la sesión: orquestación atómica que reutiliza
lo ya construido (cero lógica duplicada, cero esquema nuevo), creación en
línea con el criterio de #26, auditoría explícita del servicio y la
atomicidad demostrada contra PostgreSQL real (T13). Las mutaciones 1-3 se
reproducen al test exacto y la 4 queda explicada: la barrera del 409 es el
motor, no la envoltura.
