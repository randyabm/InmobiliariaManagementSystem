# Review — feature #13 (`inventory_tenant_review`)

**Veredicto:** APPROVED

Revisor: agente `reviewer`. Fecha: 2026-08-01. HEAD revisado: `a24df69`
(+1 commit del reviewer: fix de R7 + tres tests propios). Árbol de trabajo
limpio después de la revisión.

Línea base ejecutada por el leader: `./init.sh` exit 0, `test` **785**,
`test:db` **140**, lint, typecheck y build verdes. Línea base de los
archivos de la feature: **33/33 verdes** (invitación + OTP + revisión +
RLS).

---

## 1. Verificación por mutación

| # | Mutación | Rojos | ¿Coincide con el informe? |
|---|---|---|---|
| 1 | Scoping sin `perfil_inquilino_id = $3` | **1 / 10** | ✅ (R9: «un inquilino NO ve ni revisa el inventario de otro») |
| 2 | `buscarActiva` sin vigencia/uso | **0** solo | Capas redundantes: el chequeo del servicio lo sostiene — mutación compuesta abajo |
| 2b | Compuesta: servicio + revalidación sin `usada_en` | **3 / 10** | ✅ (R3: «usada_en evita el reuso») — el test añadido por el reviewer sostiene AMBAS capas |
| 3 | `verificar` sin comparación de hash | **1 / 9** | ✅ (R5: «401 uniforme si falla, sin distinguir motivo») |
| 4 | Revisión sin el UNIQUE de una ronda | **1 / 10** | ✅ (PA-13-2, R6) |
| 5 | R7 sin la notificación al empleado | **1 / 10** | ✅ — el fix del reviewer, ver §2 |

Rojos concretos:

- **(1)** → «inquilino B NO ve ni revisa el inventario de inquilino A»:
  sin el scoping, B leía y revisaba el inventario de A.
- **(2b)** → «invitación YA USADA → 401» (y las suites de registro que la
  consumen): el reuso volvía a servir.
- **(3)** → «código MALO → 401 uniforme»: cualquier código verificaba.
- **(4)** → «repetir el MISMO ítem → 400 por UNIQUE»: la segunda revisión
  del mismo ítem se aceptaba.
- **(5)** → «revisar TODOS los ítems → revision_completada_en»: la
  notificación al empleado desaparecía (aserción añadida).

## 2. Hallazgo del reviewer y fix

**R7 no se cumplía por completo:** el spec exige «marcar
`revision_completada_en` y **notificar al empleado** (#10, hook
declarativo)»; la implementación solo marcaba la fecha. Fix:
`RevisionInventarioService` inyecta `NotificacionesOutboxService` y, al
completar la revisión, encola la entrega al CORREO del creador del
inventario (diseño §4) con `contenido` de dominio (id del inventario, sin
PII). Test añadido: la fila `notificacion_pendiente` existe con el
destinatario del empleado. Mutación 5 lo sostiene.

**Tests añadidos por el reviewer:**
1. «invitación YA USADA → 401 uniforme» (T17): marca `usada_en` por
   poolAdmin y verifica el rechazo del bootstrap — sostenido por la doble
   capa (mut. 2b).
2. Aserción de la notificación del empleado en «revisar TODOS» (T19).
3. La limpieza de estado entre tests (restauración de `expira_en`/`usada_en`
   para no contaminar suites).

## 3. Trazabilidad requirements ↔ tests (13/13)

Verificada archivo por archivo; la tabla del implementer
(`progress/impl_inventory_tenant_review.md`) es fiel. R1–R13 [x], con
mutación que los sostiene en los puntos de riesgo (R3 → mut. 2b, R5 → mut.
3, R6 → mut. 4, R7 → mut. 5, R9 → mut. 1).

**Anclaje al PRD:** los 13 citan RF-I4, RF-I5, RF-AU2 (actualizado),
RF-AU5, RF-AU3, RF-C3, RF-C4, D2. Ningún requirement sin origen.

**Ningún test fabrica el objeto que dice verificar.** Las tablas y la
función las crea la migración 0017; el flujo completo (invitación →
registro → login → revisión) pasa por la API real; las aserciones usan
`SELECT` independientes (`token_hash`, `codigo_hash`, `user_role`,
`audit_log`, `notificacion_pendiente`, `inventario_item_revision`).

## 4. Puntos críticos revisados

1. **El token y el OTP solo como hash (R12).** `token_hash`/`codigo_hash`
   de 64 hex en la base; los valores en claro solo en la respuesta del 201
   y en el outbox (PA-13-3); el test PII serializa `audit_log` completo y
   no encuentra token, código, comentario, email ni documento.
2. **PA-13-4 (4ª vía).** `invitacion_por_token` es SECURITY DEFINER sin
   PUBLIC (migrations.db), el inventario de funciones pasa a 4 entradas, y
   el RLS test confirma que resuelve por coincidencia EXACTA y devuelve
   solo el bootstrap.
3. **PA-13-1 (cuenta persistente).** El registro valida que el documento
   del perfil coincida con el del registro (la invitación es PERSONAL,
   mutación verificada por el 401 de documento ajeno), crea la identidad
   con hash bcrypt y rol inquilino, y el login estándar #27 funciona.
4. **Scoping por entidad (R9).** `@Roles('inquilino')` + perfil del
   usuario → `perfil_inquilino_id` del inventario (mut. 1). Rutas de
   invitación rechazan al inquilino (403).
5. **401 uniforme (R12).** `InvitacionInvalidaError`/`OtpInvalidoError`
   idénticos para inexistente/expirado/usado/incorrecto.

## 5. Tasks completas

**24 / 24 `[x]`** en `specs/inventory_tenant_review/tasks.md`.

## 6. Invariantes de seguridad (C7)

- **Aislamiento por tenant:** [x] — RLS real (T21: SELECT sin WHERE,
  virgen → 0 filas, INSERT ajeno rechazado, baja ajena → 0 filas, función
  por hash exacto).
- **RBAC con test de rechazo:** [x] — T20: inquilino B → 404 del inventario
  de A, admin B → 403 por rol, 401 sin token, 403 del inquilino en
  invitaciones.
- **Auditoría de acciones críticas:** [x] — T22: invitación, OTP y revisión
  con `entity_id` y `metadata` vacío.
- **Sin secretos hardcodeados:** [x] — sin secretos nuevos.
- **Datos personales en logs:** [x] — T22: serializado de `audit_log` sin
  token/código/comentario/email/documento.
- **Integridad documental (SHA-256):** [x] — foto del inquilino con hash en
  `inventario_item_foto` (T19).

## 7. Checkpoints

C1 [x] · C2 [x] · C3 [x] · C4 [x] · C5 [x] · C6 [x] · C7 [x] · C8 n/a

---

## Bloqueantes

**Ninguno.** (El hallazgo de R7 se corrigió en esta revisión.)

## Deuda anotada (no bloqueante)

- **D-1 —** La revalidación dentro del RLS (`buscarActiva`) y el chequeo
  del servicio sobre la función son dos capas redundantes para el reuso de
  la invitación: ninguna sola es observable (mut. 2 inerte individual).
  Es defensa en profundidad — la función solo arranca el contexto, el RLS
  es la barrera; el test compuesto las sostiene a ambas.
- **D-2 —** El OTP no tiene límite de intentos ni de solicitudes por
  ventana (5 intentos / 3 solicitudes): el 401 uniforme mitiga la
  enumeración, pero un límite explícito es feature de endurecimiento
  (anotado para #14, que consume OTP de FIRMA).
- **D-3 —** `RegistroInvitacionService` duplica la generación de OTP
  (código + hash + outbox) en lugar de delegar en `OtpService.solicitar`
  (que exige actorId): pequeño refactor de consolidación posible cuando
  #14 toque el OTP; no bloquea.

## Recomendación

**Cerrar #13 como `done`.** La invitación segura (hash, expiración, uso
único — mut. 2b), la cuenta persistente con OTP (mut. 3) y la revisión
scopada del inquilino (mut. 1) quedan sostenidas por tests que fallan bajo
mutación. La notificación al empleado de R7 quedó implementada y probada
(mut. 5). #14 tiene el OTP de FIRMA listo y la infraestructura de
evidencia.
