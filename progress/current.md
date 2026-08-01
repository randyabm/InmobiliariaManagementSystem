# Sesión actual

> Este archivo se vacía al cerrar cada sesión y su resumen se mueve a
> `history.md`. Mientras trabajas, **mantenlo actualizado en tiempo real**,
> no al final.

- **Feature en curso:** _ninguna_ — la #25 `retencion_codeudor_referencias`
  quedó `done` el 2026-08-01.
- **Agente:** — (sesión cerrada)

## Pendientes de decisión del humano

1. **El push sigue sin hacerse.** Forgejo no responde en `127.0.0.1:3000`
   (feature #23, aún sin montar). El remoto `origin` → GitHub no está
   autorizado como destino. Todo el trabajo vive en un solo disco.
2. **PA-14** sigue abierta: quién da de alta una inmobiliaria y asigna su
   `codigo`. El PRD menciona el Super Admin pero no define ningún `RF-*` de
   onboarding.
3. **Deuda del review de #25 (D-1, D-2):** cuando exista el consumidor de la
   tarifa (módulo de pagos), reescribir el unit test con repositorio real y
   añadir el test de forma SQL para `sujetoDeRetencion`.

## Cola

- **#27** `sesion_y_revocacion` — `pending`, sin spec todavía.
- **#6** `property_profile` — `pending`, siguiente del orden original.
- El **portal del cliente** (RF-AU2/AU4) no existe como feature y ya bloquea
  cobertura: R18 de #26 solo pudo demostrarse por vías indirectas porque no
  hay ninguna ruta de cliente en el sistema.
