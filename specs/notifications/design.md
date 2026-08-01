# Design — notifications

> Feature #10. Motor de notificaciones asíncronas (RF-N1, RF-N2, RF-W3).
> Este documento asume `docs/architecture.md` y `docs/conventions.md`.

---

## 1. El problema: disparo declarativo, entrega asíncrona, sin infra nueva

El PRD §11 lista BullMQ (Redis) para la cola. Esta feature propone el
**outbox transaccional** (PA-10-1): la fila de notificación se escribe en la
MISMA transacción que la transición del workflow, y un procesador en
proceso (cada 60 s, y en su variante directa para los tests) la despacha.
La atomicidad es real (si la transición revierte, la notificación también —
algo que BullMQ no puede garantizar) y no se añade Redis como dependencia
dura de runtime.

```
workflow (transición) ──hook──▶ notificacion_pendiente (outbox, misma tx, R2)
                                      │ procesador (cada 60 s / directo)
                                      ▼
                        resuelve destinatario/canal (R7) ──▶ ProveedorNotificaciones
                                      │                        └── ProveedorRegistro
                                      ▼                          (notificacion_enviada,
                                PROCESADA / FALLIDA                append-only, R6)
                                      ▲
                        notificacion_programada (vencidas, R12)
```

## 2. El gancho del motor (R2, R18, PA-10-4)

`WorkflowService` (motor #7) inyecta `NotificacionesOutboxService` y, tras
cada transición ejecutada (humana o automática), si
`transicion.notificacion` no está vacío, escribe la fila del outbox con el
mismo `ctx.cliente` (la transacción de la petición). Nada más: el motor no
conoce proveedores ni destinatarios; solo traslada el hook a datos.

La forma del hook (la de #7, ampliada con `destinatario`):

```jsonc
// workflow_transicion.notificacion
{ "canal": "CORREO",                        // opcional: si falta, el medio preferido (R7)
  "plantilla": "contrato_generado",
  "destinatario": { "tipo": "propietario_principal" } }
// o { "destinatario": { "email": "x@y.z" } }  |  { "destinatario": { "celular": "..." } }
```

`contenido` se construye con sustitución mínima de `{entidad}` y
`{estado}` desde la instancia; el destinatario se resuelve al procesar
(R7), no al encolar — el outbox guarda la intención, el procesador el
contexto final.

## 3. El procesador (R3, R4, R12, R14)

`NotificacionesProcesador.procesarPendientes()`:

```
1. SELECT id, tenant_id FROM notificacion_pendiente WHERE estado='PENDIENTE'
   ORDER BY created_at  (los de TODOS los tenants: el procesador es global)
2. por fila:
   a. BEGIN; SET LOCAL app.current_tenant = fila.tenant_id   (R14)
   b. resolver destinatario/canal (R7) — si no resoluble → FALLIDA (sin lanzar)
   c. proveedor.enviar(...) — ProveedorRegistro INSERT en notificacion_enviada
   d. UPDATE outbox SET estado='PROCESADA', procesada_en=now()   (o FALLIDA+intentos)
3. mismo bucle para notificacion_programada vencidas (R12): PENDIENTE y
   programada_para <= now() → despacha → EJECUTADA
```

Se ejecuta con un `setInterval` de 60 s desde `onModuleInit`
(desenredado: si el procesamiento tarda más que el intervalo, no se
superpone — flag `enProceso`). Los tests llaman al método directo
(determinista). El `interval` no se inicia si `NODE_ENV === 'test'` ni si
`NOTIFICACIONES_INTERVALO_MS = 0`.

## 4. Proveedores (R5, R6, PA-10-2)

```ts
interface ProveedorNotificaciones {
  enviar(datos: { tenantId: string; canal: string; destinatario: string;
                  contenido: unknown }): Promise<void>;
}
```

`ProveedorRegistro` escribe `notificacion_enviada` (con su propio cliente
de la transacción del procesador). `ProveedoresRegistro` (un provider
registrado en el módulo) mapea canal → proveedor; el canal desconocido →
`FALLIDA`. Los proveedores reales (nodemailer, SMS, WhatsApp) se añaden
sin tocar el procesador.

`notificacion_enviada` es append-only (triggers, patrón `audit_log`,
`0006`): la historia de lo enviado no se muta ni se borra (R6).

## 5. Superficie HTTP (5 rutas)

| Método y ruta | Rol | R | Auditoría |
|---|---|---|---|
| `POST /notificaciones` | admin/empleado | R8 | `@Audit('crear','notificacion_pendiente')` |
| `GET /notificaciones` | admin/empleado | R9 | — |
| `POST /notificaciones/programadas` | admin/empleado | R11 | `@Audit('crear','notificacion_programada')` |
| `GET /notificaciones/programadas` | admin/empleado | R11 | — |
| `DELETE /notificaciones/programadas/:id` | admin/empleado | R11 | `@Audit('baja','notificacion_programada')` |

Firmas nuevas relevantes:

```ts
// notificaciones-outbox.service.ts (núcleo transaccional, usado por el motor)
escribirDesdeTransicion(transicion, instancia, ctx): Promise<void>;  // R2
crear(datos: { destinatario; canal?; contenido }, ctx): Promise<Pendiente>;  // R8

// notificaciones-procesador.service.ts
procesarPendientes(): Promise<{ procesadas: number; fallidas: number }>;  // R3, R12

// proveedor-notificaciones.ts (interfaz) + proveedor-registro.ts (R5)
// resolver-destinatario.ts (R7): perfil por entidad de la instancia
```

## 6. Migración (`0014_notifications.sql`, R17)

Forward-only e idempotente:

1. `notificacion_pendiente` (R1): CHECK de estado, `intentos` default 0,
   índice `(tenant_id, estado, created_at)`, RLS ENABLE+FORCE+política.
2. `notificacion_enviada` (R6): CHECK de estado, índice `(tenant_id,
   created_at)`, RLS + triggers append-only (`trg_notif_no_update` /
   `trg_notif_no_delete`).
3. `notificacion_programada` (R10): CHECK de estado, índice
   `(tenant_id, estado, programada_para)`, RLS.
4. **No** toca el hook existente de #7 (el `notificacion` de las
   transiciones ya es dato; el seed no cambia).

## 7. Errores de dominio

| Error | `code` | HTTP | Cuándo |
|---|---|---|---|
| `NotificacionNoResolubleError` (nuevo, interno) | `NOTIFICACION_NO_RESOLUBLE` | — (se traduce a FALLIDA) | R7: perfil/canal irresoluble |
| `ResourceNotFoundError` (reutilizado) | `RESOURCE_NOT_FOUND` | 404 | R14 |
| `SinContextoDeTenantError` (reutilizado) | `SIN_CONTEXTO_DE_TENANT` | 500 | R16 |

## 8. Archivos

### Se crean

```
apps/api/drizzle/0014_notifications.sql
apps/api/src/database/schema/{notificacion-pendiente,notificacion-enviada,notificacion-programada}.ts
apps/api/src/modules/core/notificaciones/
├── notificaciones.module.ts
├── notificaciones-outbox.service.ts
├── notificaciones-procesador.service.ts
├── proveedor-notificaciones.ts        (interfaz)
├── proveedor-registro.ts
├── resolver-destinatario.ts
├── notificaciones.controller.ts
├── dto/ (enviar-notificacion, programar-notificacion)
├── errors/ (notificacion-no-resoluble)
└── __tests__/
apps/api/src/database/__tests__/notificaciones-rls.test.ts
```

### Se modifican

```
apps/api/src/modules/core/workflows/workflow.service.ts   (gancho R2, R18)
apps/api/src/modules/core/workflows/workflows.module.ts    (importa NotificacionesModule)
apps/api/src/modules/core/core.module.ts                   (registra NotificacionesModule)
apps/api/src/database/schema/index.ts
apps/api/drizzle/meta/_journal.json
tests/migrations.test.ts                    (TABLAS_PERMITIDAS +3)
apps/api/src/modules/core/__tests__/routes-surface.test.ts  (RUTAS_PERMITIDAS +5)
apps/api/test/db/migrations.db.test.ts       (tablas, RLS, triggers append-only)
packages/types/src/notificaciones.ts + index.ts
feature_list.json                            (#10 → spec_ready)
```

## 9. Alternativas descartadas

1. **BullMQ/Redis como cola.** Descartada para el MVP (PA-10-1): el outbox
   transaccional da atomicidad con la transición (que BullMQ no da), no
   añade runtime de Redis al arranque, y los tests son deterministas sin
   infra nueva. Anotado como deuda de escalabilidad: si el volumen lo
   exige, el procesador se mueve a un worker BullMQ leyendo la misma tabla.
2. **Enviar sincrónicamente en la petición.** Descartada: RF-N1 exige la
   cola; un envío lento (SMTP) no puede bloquear la transición.
3. **El motor conoce a los proveedores.** Descartada (R18): el motor solo
   traslada el hook al outbox; proveedores y destinatarios son de #10.
4. **Plantillas gestionadas (librería).** Descartada: sustitución mínima de
   variables y la `plantilla` como dato; una librería de plantillas sería
   inventar producto.

## 10. Estado de las ambigüedades

Las cuatro decisiones de la puerta (PA-10-1…PA-10-4) quedan explícitas. El
contenido exacto de las notificaciones de negocio (qué se dice en cada
transición) lo definen los módulos consumidores (#13, #19) al declarar
hooks o programar recordatorios; #10 entrega el motor. No quedan
ambigüedades de producto.
