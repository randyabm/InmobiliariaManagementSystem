# Sesión actual

> Este archivo se vacía al cerrar cada sesión y su resumen se mueve a
> `history.md`. Mientras trabajas, **mantenlo actualizado en tiempo real**,
> no al final.

- **Feature en curso:** _ninguna_ — la #27 `sesion_y_revocacion` quedó
  `done` el 2026-08-01.
- **Agente:** — (sesión cerrada)

## Pendientes de decisión del humano

1. **El push sigue sin hacerse.** Forgejo no responde en `127.0.0.1:3000`
   (feature #23, aún sin montar). El remoto `origin` → GitHub no está
   autorizado como destino. Todo el trabajo vive en un solo disco.
2. **PA-14** sigue abierta: quién da de alta una inmobiliaria y asigna su
   `codigo`. El PRD menciona el Super Admin pero no define ningún `RF-*` de
   onboarding.
3. **Deudas de reviews:** #25 D-1/D-2 (tarifa: unit test con repo real y
   test de forma SQL cuando exista el consumidor de pagos); #26 D-3/D-4
   (portal del cliente, token de login como Bearer); #27 D-1/D-2/D-3
   (header en refresh/logout, arnés `ver: 0`, ip en refresh auditado).

## Cola

- **#6** `property_profile` — `pending`, siguiente del orden original.
- El **portal del cliente** (RF-AU2/AU4) no existe como feature y ya bloquea
  cobertura: R18 de #26 solo pudo demostrarse por vías indirectas porque no
  hay ninguna ruta de cliente en el sistema.
