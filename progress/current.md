# Sesión actual

> Este archivo se vacía al cerrar cada sesión y su resumen se mueve a
> `history.md`. Mientras trabajas, **mantenlo actualizado en tiempo real**,
> no al final.

- **Feature en curso:** _ninguna_ — la #6 `property_profile` quedó `done` el
  2026-08-01. **Fase 1a de fundaciones completa** (10 features).
- **Agente:** — (sesión cerrada)

## Pendientes de decisión del humano

1. **El push sigue sin hacerse.** Forgejo no responde en `127.0.0.1:3000`
   (feature #23, aún sin montar). El remoto `origin` → GitHub no está
   autorizado como destino. Todo el trabajo vive en un solo disco.
2. **PA-14** sigue abierta: quién da de alta una inmobiliaria y asigna su
   `codigo`. El PRD menciona el Super Admin pero no define ningún `RF-*` de
   onboarding.
3. **Deudas de reviews:** #25 D-1/D-2 (tarifa); #26 D-3/D-4 (portal, token
   de login); #27 D-1/D-2/D-3 (header refresh/logout, arnés `ver: 0`, ip);
   #6 D-1/D-2/D-3 (sonda de rutas, credenciales MinIO sin default antes de
   producción, #8 reutilizará la ficha).

## Cola

- **#8** `property_lifecycle` — `pending`, siguiente del orden original
  (ciclo de vida sobre el motor de workflows + dashboard, RF-P4/P5).
- **#7** `workflow_engine` — `pending` (precede al #8: el ciclo de vida
  transiciona sobre el motor).
- El **portal del cliente** (RF-AU2/AU4) no existe como feature y ya bloquea
  cobertura: R18 de #26 solo pudo demostrarse por vías indirectas porque no
  hay ninguna ruta de cliente en el sistema.
