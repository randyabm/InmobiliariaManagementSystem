# Sesión actual

> Este archivo se vacía al cerrar cada sesión y su resumen se mueve a
> `history.md`. Mientras trabajas, **mantenlo actualizado en tiempo real**,
> no al final.

- **Feature en curso:** #7 `workflow_engine` — status **`in_progress`**
- **Agente:** leader → spec_author → implementer → **reviewer (APROBADO)**
- **Estado:** ⏸ **esperando que el humano autorice marcarla `done`.**

## Estado de la verificación

`./init.sh` exit 0 — `npm run test` **619** (61 archivos) y `npm run test:db`
**108** (3 archivos). Lint, typecheck y build verdes.

27/27 tasks. Veredicto en `progress/review_workflow_engine.md`:
**APROBADO, sin bloqueantes**. El reviewer reprodujo cinco mutaciones del
implementer (1/8 fail-open, 1/6 límite de cascada, 1/13 clon, 1/8 política
del sistema, 1/6 contexto fusionado) y confirmó que sin el límite de la
cascada el test de ciclo **se cuelga** (barrera de disponibilidad).

## Espec

`specs/workflow_engine/` — aprobado por el humano con las cuatro decisiones
PA-7 (tenant reservado + RLS con OR/WITH CHECK; condiciones whitelisted;
cascada con límite; RF-W2 base). La migración siembra `ciclo_vida_propiedad`
como datos: el #8 transicionará sobre él.

## Pendientes de decisión del humano (previos, no bloquean la puerta del spec)

- **El push sigue sin hacerse.** Forgejo no responde en `127.0.0.1:3000`
  (feature #23, aún sin montar). El remoto `origin` → GitHub no está
  autorizado como destino. Todo el trabajo vive en un solo disco.
- **PA-14** sigue abierta: quién da de alta una inmobiliaria y asigna su
  `codigo`. El PRD menciona el Super Admin pero no define ningún `RF-*` de
  onboarding.
- **Deudas de reviews:** #25 D-1/D-2; #26 D-3/D-4; #27 D-1/D-2/D-3; #6
  D-1/D-2/D-3.

## Cola

- **#8** `property_lifecycle` — `pending` (transiciona sobre el motor #7).
- El **portal del cliente** (RF-AU2/AU4) no existe como feature y ya bloquea
  cobertura: R18 de #26 solo pudo demostrarse por vías indirectas porque no
  hay ninguna ruta de cliente en el sistema.
