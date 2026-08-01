# Tasks — notifications

> Feature #10. Pasos discretos en orden. Las tasks de test son de primera
> clase: los invariantes de seguridad (bloque 5) se verifican con asserts
> deterministas contra PostgreSQL real (Testcontainers).
>
> **Prerrequisitos:** #7 `done` (el hook `notificacion` como dato) y #5
> `done` (perfiles y medio preferido). Sin dependencias nuevas de runtime
> (PA-10-1: outbox + procesador en proceso, sin BullMQ/Redis).
>
> **PA-10 aprobadas en la puerta del spec:** PA-10-1 (outbox transaccional),
> PA-10-2 (interfaz + ProveedorRegistro), PA-10-3 (destinatario/canal del
> hook o del medio preferido), PA-10-4 (gancho en WorkflowService).
>
> Cobertura: R1–R18 en 25 tasks (T1–T25), de las cuales 11 son tasks de test.

---

## Bloque 0 — Tipos y esquema Drizzle

- [ ] T1 — Crear `packages/types/src/notificaciones.ts` con
  `CanalNotificacion`, `DestinatarioHook`, `NotificacionPendiente`,
  `NotificacionEnviada`, `NotificacionProgramada`, `HookNotificacion`
  (ampliando el de #7 con `destinatario`) y exportar desde el index.
  **Cubre: R1, R7, R10.**

- [ ] T2 — Crear los tres esquemas Drizzle (pendiente, enviada, programada)
  con CHECKs, índices y exportarlos en `schema/index.ts`. **Cubre: R1, R6,
  R10.**

## Bloque 1 — Migración

- [ ] T3 — Escribir `0014_notifications.sql` (siguiente índice libre),
  forward-only e idempotente: las tres tablas con
  `ENABLE`+`FORCE RLS` y política por `tenant_id` en la misma migración, y
  los triggers append-only de `notificacion_enviada`. **Cubre: R1, R6,
  R10, R17.**

- [ ] T4 — Añadir la entrada al `_journal.json`, `TABLAS_PERMITIDAS` +3 en
  `tests/migrations.test.ts` y test en `migrations.db.test.ts` (las tres
  tablas con RLS `true`/`true`, políticas por `app.current_tenant` y
  `notificacion_enviada` append-only incluso para el dueño — UPDATE/DELETE
  rechazados). **Cubre: R6, R17.**

## Bloque 2 — Outbox y gancho del motor

- [ ] T5 — `notificaciones-outbox.service.ts`: `escribirDesdeTransicion`
  (construye `contenido` con sustitución mínima `{entidad}`/`{estado}` y
  escribe la fila en el `ctx.cliente` de la petición) y `crear` (R8).
  **Cubre: R1, R2, R8.**

- [ ] T6 — Gancho en `WorkflowService` (R2, R18): tras cada transición con
  `notificacion` no vacía, escribir el outbox en la misma transacción; con
  hook vacío, nada. Inyectar el outbox service en el motor y registrar
  `NotificacionesModule` en `WorkflowsModule` (sin circularidad: el módulo
  de notificaciones no importa workflows). **Cubre: R2, R18.**

- [ ] T7 — Test de integración del gancho: una definición de prueba con
  transición que declara `notificacion` → al ejecutarla, la fila del outbox
  existe en la MISMA transacción (SELECT); una transición sin hook → 0
  filas; una transición que falla (condición falsa) → 0 filas (rollback del
  outbox incluido). **Cubre: R2, R18.**

## Bloque 3 — Procesador y proveedores

- [ ] T8 — `proveedor-notificaciones.ts` (interfaz) y `proveedor-registro.ts`
  (escribe `notificacion_enviada`). **Cubre: R5, R6.**

- [ ] T9 — `resolver-destinatario.ts` (R7): `inquilino_actual`/
  `propietario_principal` resuelto desde la entidad de la instancia
  (perfil_inquilino/perfil_propietario), o email/celular directos; canal =
  el del hook o el `medio_preferido_contacto` del perfil; irresoluble →
  `NotificacionNoResolubleError`. **Cubre: R7.**

- [ ] T10 — `notificaciones-procesador.service.ts` (R3, R4, R12): toma las
  `PENDIENTE` de todos los tenants (una a una con `SET LOCAL` de su
  tenant), resuelve, despacha por el registro de proveedores, marca
  `PROCESADA`/`FALLIDA` con `intentos`; las `programadas` vencidas se
  despachan y marcan `EJECUTADA`. `procesarPendientes()` invocable
  directamente; el `setInterval` de 60 s arranca en `onModuleInit` salvo en
  test. **Cubre: R3, R4, R12, R14.**

- [ ] T11 — Test del procesador (determinista, Testcontainers): outbox con
  filas de dos tenants → `procesarPendientes()` las despacha cada una bajo
  SU tenant (SELECT de `notificacion_enviada` con `tenant_id` correcto y
  outbox `PROCESADA`); una fila con destinatario irresoluble → `FALLIDA`
  con `intentos = 1` y `error` sin PII; 3 fallos → `FALLIDA` definitiva
  (R4). **Cubre: R3, R4, R7, R14.**

- [ ] T12 — Test de programadas: una vencida (`programada_para` en el
  pasado) se despacha y queda `EJECUTADA`; una futura no; una `CANCELADA`
  no. **Cubre: R12.**

## Bloque 4 — Endpoints

- [ ] T13 — DTOs `enviar-notificacion.dto.ts` y
  `programar-notificacion.dto.ts` (zod: destinatario id/email/celular,
  canal opcional, contenido libre acotado). **Cubre: R8, R11.**

- [ ] T14 — `notificaciones.controller.ts` con las 5 rutas del design §5,
  guards, `@Roles('admin','empleado')` y `@Audit` en las mutaciones.
  **Cubre: R8, R9, R11, R14.**

- [ ] T15 — Registrar el módulo en `CoreModule`, los providers y ampliar
  `RUTAS_PERMITIDAS` (+5). **Cubre: R17.**

- [ ] T16 — Tests de integración de endpoints: `POST /notificaciones` → 201
  y la fila del outbox existe (SELECT); `GET /notificaciones` lista
  pendientes y enviadas del tenant; `POST /notificaciones/programadas` →
  201; `GET` lista; `DELETE` cancela (SELECT `CANCELADA`). **Cubre: R8, R9,
  R11.**

## Bloque 5 — Invariantes de seguridad (tests deterministas, obligatorios)

- [ ] T17 — `apps/api/src/database/__tests__/notificaciones-rls.test.ts`
  (Testcontainers, rol sin `BYPASSRLS`): `SELECT *` sin `WHERE` sobre las
  tres tablas devuelve solo filas del tenant activo; conexión virgen → 0
  filas; pedir por id una fila ajena → 0 filas. **Cubre: R14, R16.**

- [ ] T18 — Test HTTP de aislamiento (R14): `GET /notificaciones` de A no
  lista filas de B (SELECT); `DELETE` de una programada de B → 404
  indistinguible; `POST` no puede escribir con tenant ajeno (RLS).
  **Cubre: R14.**

- [ ] T19 — Test HTTP de RBAC (R14): `propietario`/`inquilino` → 403 en las
  5 rutas; `empleado` → 200/201; sin token → 401. **Cubre: R14.**

- [ ] T20 — Test de PII (R15): el `contenido` con valores distintivos
  (correos, celulares, documentos) no aparece en los logs capturados ni en
  `audit_log.metadata`; el `error` del outbox no contiene el contenido ni
  el destinatario (SELECT). **Cubre: R15.**

- [ ] T21 — Test del gancho sin cambiar la semántica (R18): una transición
  con hook se ejecuta igual que sin él (mismo estado, mismo log de
  dominio), aunque el envío después falle. **Cubre: R18.**

## Bloque 6 — Integración y cierre

- [ ] T22 — Unit test de `resolver-destinatario` con dobles: los cuatro
  casos del hook (inquilino_actual, propietario_principal, email directo,
  celular directo), canal preferido, e irresoluble → error sin PII.
  **Cubre: R7.**

- [ ] T23 — Revisar `tests/ddl-en-tests.test.ts`: ningún test crea las
  tablas nuevas; la suite anti-DDL sigue verde. **Cubre: R17 (C3).**

- [ ] T24 — Escribir el mapa de trazabilidad `R1..R18 → test concreto` en
  `progress/impl_notifications.md`, con las decisiones PA-10 ejecutadas y
  la frontera #13/#19 anotada. **Cubre: trazabilidad (`docs/specs.md`).**

- [ ] T25 — Ejecutar `npm run lint`, `npm run typecheck`, `npm run test`,
  `npm run test:db` y `npm run build`; después `./init.sh` con exit code 0.
  **Verificación final y cierre.**
