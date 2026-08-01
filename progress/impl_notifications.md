# Implementación — feature #10 (`notifications`)

**Status:** implementación completa, a la espera del review. Suite: `npm run
test` **706** (76 archivos) + `npm run test:db` **116** (3 archivos). Lint,
typecheck y build verdes.

## Mapa de trazabilidad R1–R18 → test concreto

| R | Enunciado (resumen) | Test que lo cubre |
|---|---|---|
| R1 | Tabla `notificacion_pendiente` (outbox) + RLS | `migrations.db.test.ts` + `notificaciones-rls.test.ts` |
| R2 | Gancho transaccional: hook → outbox en la misma tx; sin hook → nada; rollback | `gancho-api.test.ts` T7 |
| R3 | Procesador global (bootstrap por tenant + SET LOCAL) | `procesador.test.ts` T11 (dos tenants) + `notificaciones-rls.test.ts` (bootstrap) |
| R4 | Reintentos acotados (3) sin PII en el error | `procesador.test.ts` T11 |
| R5 | Interfaz de proveedores + ProveedorRegistro | `procesador.test.ts` (despacho real) + `proveedor-registro.ts` |
| R6 | `notificacion_enviada` append-only | `migrations.db.test.ts` (triggers, dueño) |
| R7 | Destinatario/canal (tipos, directos, medio preferido) | `resolver-destinatario.test.ts` T22 + `procesador.test.ts` (directos) |
| R8 | Envío manual por el outbox | `endpoints.api.test.ts` T16 |
| R9 | Listado de entregas y pendientes | `endpoints.api.test.ts` T16 |
| R10 | Tabla `notificacion_programada` + RLS | `migrations.db.test.ts` + `notificaciones-rls.test.ts` |
| R11 | Crear/listar/cancelar recordatorios | `endpoints.api.test.ts` T16 |
| R12 | Ejecutar vencidos (PENDIENTE ≤ now → EJECUTADA) | `procesador.test.ts` T12 |
| R13 | Frontera: recordatorios específicos de #13 | anotado en el spec (sin código) |
| R14 | Aislamiento 404/403/401; procesador por tenant | `seguridad.api.test.ts` T18/T19 + `notificaciones-rls.test.ts` |
| R15 | PII fuera de logs y audit_log; error sin contenido | `seguridad.api.test.ts` T20 + `procesador.test.ts` T11 |
| R16 | Sin contexto falla | `notificaciones-rls.test.ts` (virgen → 0 filas) |
| R17 | Migración 0014 + TABLAS +3 + RUTAS +5 | `tests/migrations.test.ts` + `routes-surface.test.ts` |
| R18 | El gancho no cambia la semántica del motor | `gancho-api.test.ts` T21 |

**Anclaje al PRD:** R1–R18 citan RF-N1, RF-N2, RF-W3, RF-C4, RF-W4, §11,
D2, §6.4. Ningún requirement sin origen.

## Decisiones PA-10 ejecutadas (aprobadas en la puerta del spec)

- **PA-10-1 — Outbox transaccional + procesador en proceso** (60 s, sin
  superposición; sin BullMQ/Redis). La fila se escribe y revierte CON la
  transición (R2, probado en T7 con la condición falsa → 0 filas).
- **PA-10-2 — Interfaz + `ProveedorRegistro`** (append-only). Sin
  proveedores externos; el patrón permite enchufarlos sin tocar el
  procesador.
- **PA-10-3 — Destinatario/canal:** el hook declara `destinatario` (tipos
  resueltos desde la entidad de la instancia, o email/celular directos) y
  el canal es el del hook o el `medio_preferido_contacto` del perfil
  (RF-C4) — `resolver-destinatario.test.ts`.
- **PA-10-4 — Gancho en `WorkflowService`:** tras cada transición con hook
  no vacío, escribe el outbox en la misma transacción; la semántica del
  motor no cambia (T21: mismo estado, mismo log, sin filas extra).

## La tercera vía fuera del RLS (patrón R52/R18)

El procesador es global y no puede saber el tenant de una fila antes de
leerla: `notificaciones_tenants_a_procesar()` devuelve SOLO los
`tenant_id` con trabajo (outbox PENDIENTE ∪ recordatorios vencidos),
`SECURITY DEFINER`, `REVOKE FROM PUBLIC`, concedida al rol de aplicación.
El inventario de funciones de `migrations.db.test.ts` creció a **tres**
(tenant_por_codigo, sesion_por_refresh_token, notificaciones_tenants_a_procesar)
y sigue vigilando que no aparezca una cuarta.

## Desviaciones anotadas (todas en el spec o menores)

1. **`esquemaAnadirTransicion` del motor ampliado con `notificacion`** (el
   hook como dato al añadir transiciones) y `WorkflowRepository
   .insertarTransicion` ahora la persiste — era el hueco que el test del
   gancho detectó (la transición añadida perdía el hook).
2. **La función bootstrap devuelve tenants, no filas**: el procesador
   reabre todo dentro del RLS de cada tenant (defensa en profundidad).
3. **El test T20 de #8 se actualizó**: ya no verifica «no existen tablas de
   notificación» (ahora existen, R17) sino «la transición del seed sin hook
   no genera trabajo» — la propiedad de la frontera R8 se mantiene.

## Candidatas a mutación (para el reviewer)

1. Quitar el gancho del `WorkflowService.registrar` → rompe T7 (outbox 0).
2. `hookDe` devolviendo `{}` como hook válido (escribir siempre) → rompe T7
   (transición sin hook deja fila).
3. El procesador sin `SET LOCAL` del tenant de la fila → rompe T11 (las
   entregas quedan en el tenant equivocado o 0).
4. `resolverDestino` usando siempre `CORREO` (ignorando el medio preferido)
   → rompe T22 (WHATSAPP).
5. Reintentos ilimitados (sin el `>= 3`) → rompe T11 (FALLIDA definitiva).
6. `procesarProgramadasVencidas` sin el filtro `programada_para <= now()` →
   rompe T12 (la futura se ejecuta).
7. Quitar los triggers append-only de `notificacion_enviada` → rompe
   `migrations.db.test.ts`.
