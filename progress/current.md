# Sesión actual

> Este archivo se vacía al cerrar cada sesión y su resumen se mueve a
> `history.md`. Mientras trabajas, **mantenlo actualizado en tiempo real**,
> no al final.

- **Feature en curso:** #10 `notifications` — status **`spec_ready`**
- **Agente:** leader → spec_author (3 archivos listos) → ⏸ **HUMANO**
- **Estado:** ⏸ **esperando la aprobación del spec.** Meta de la sesión:
  **completar toda la fase 1** (1b + 1c + #23). NO se toca código hasta
  aprobar cada spec.

## Espec — `specs/notifications/`

Motor de notificaciones asíncronas (RF-N1/N2, RF-W3). 18 requirements
(R1–R18), 25 tasks (11 de test). Consume el hook `notificacion` que #7 dejó
como dato. `./init.sh` verde (674 + 108 tests) antes de redactar el spec.

## Decisiones técnicas que el humano debe confirmar (design.md §10)

1. **PA-10-1 — Outbox transaccional + procesador en proceso** (cada 60 s),
   en vez de BullMQ/Redis (PRD §11): la fila se escribe y revierte CON la
   transición; tests deterministas sin infra nueva. BullMQ queda como
   deuda de escalabilidad.
2. **PA-10-2 — Interfaz + `ProveedorRegistro`** como único proveedor MVP
   (persiste en `notificacion_enviada` append-only); email/SMS/WhatsApp se
   enchufan detrás de la interfaz cuando existan credenciales (no hay
   SMTP/APIs en el entorno).
3. **PA-10-3 — Destinatario/canal**: el hook declara `destinatario`
   (inquilino_actual / propietario_principal / email/celular directo) y el
   canal es el del hook o el `medio_preferido_contacto` del perfil (RF-C4).
4. **PA-10-4 — Gancho en `WorkflowService`**: tras cada transición con
   hook, escribe el outbox en la misma transacción; sin cambiar la
   semántica del motor (R18).

## Pendientes de decisión del humano

1. **El push sigue sin hacerse.** Forgejo no responde en `127.0.0.1:3000`
   (feature #23, aún sin montar). El remoto `origin` → GitHub no está
   autorizado como destino. Todo el trabajo vive en un solo disco.
2. **PA-14** sigue abierta: quién da de alta una inmobiliaria y asigna su
   `codigo`. El PRD menciona el Super Admin pero no define ningún `RF-*` de
   onboarding.
3. **Deudas de reviews:** #25 D-1/D-2; #26 D-3/D-4; #27 D-1/D-2/D-3; #6
   D-1/D-2/D-3; #7 D-1/D-2/D-3; #8 D-1/D-2/D-3; #9 D-1/D-2/D-3.

## Cola (fase 1b)

- **#10** `notifications` — `pending` (consumirá el hook `notificacion`
  que #7 dejó como dato).
- **#23** `ci_pipeline` — `pending` (Forgejo sin montar; también bloquea el
  push).
- **#11–#15** — inventarios (templates, creación con fotos, revisión del
  inquilino, firma+PDF, PWA offline).
- El **portal del cliente** (RF-AU2/AU4) no existe como feature y ya bloquea
  cobertura: R18 de #26 solo pudo demostrarse por vías indirectas porque no
  hay ninguna ruta de cliente en el sistema.
