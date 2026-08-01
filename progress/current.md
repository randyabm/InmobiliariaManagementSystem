# Sesión actual

> Este archivo se vacía al cerrar cada sesión y su resumen se mueve a
> `history.md`. Mientras trabajas, **mantenlo actualizado en tiempo real**,
> no al final.

- **Feature en curso:** _ninguna_ — la #8 `property_lifecycle` quedó `done`
  el 2026-08-01. **12 features cerradas** en la fase 1a.
- **Agente:** — (sesión cerrada)

## Pendientes de decisión del humano

1. **El push sigue sin hacerse.** Forgejo no responde en `127.0.0.1:3000`
   (feature #23, aún sin montar). El remoto `origin` → GitHub no está
   autorizado como destino. Todo el trabajo vive en un solo disco.
2. **PA-14** sigue abierta: quién da de alta una inmobiliaria y asigna su
   `codigo`. El PRD menciona el Super Admin pero no define ningún `RF-*` de
   onboarding.
3. **Deudas de reviews:** #25 D-1/D-2; #26 D-3/D-4; #27 D-1/D-2/D-3; #6
   D-1/D-2/D-3; #7 D-1/D-2/D-3; #8 D-1/D-2/D-3.

## Cola

- **#9** `property_intake` — `pending`, siguiente (ingreso con creación en
  línea, RF-PI1..PI3), reutiliza el camino de #6/#8.
- **#10** `notifications` — `pending` (consumirá el hook `notificacion` que
  #7 dejó como dato).
- El **portal del cliente** (RF-AU2/AU4) no existe como feature y ya bloquea
  cobertura: R18 de #26 solo pudo demostrarse por vías indirectas porque no
  hay ninguna ruta de cliente en el sistema.
