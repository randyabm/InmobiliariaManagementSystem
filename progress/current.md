# Sesión actual

> Este archivo se vacía al cerrar cada sesión y su resumen se mueve a
> `history.md`. Mientras trabajas, **mantenlo actualizado en tiempo real**,
> no al final.

- **Feature en curso:** #27 `sesion_y_revocacion` — status **`in_progress`**
- **Agente:** leader → spec_author → implementer → **reviewer (APROBADO)**
- **Estado:** ⏸ **esperando que el humano autorice marcarla `done`.**

## Estado de la verificación

`./init.sh` exit 0 — `npm run test` **524** (50 archivos) y `npm run test:db`
**88** (3 archivos). Lint y typecheck verdes.

28/28 tasks. Veredicto en `progress/review_sesion_y_revocacion.md`:
**APROBADO, sin bloqueantes**. El reviewer reprodujo seis mutaciones del
implementer (1/16, 2/16, 1/16, 3/15, 3/16, 1/5), todas al test exacto.

## Espec

`specs/sesion_y_revocacion/` — aprobado por el humano con las cuatro
decisiones PA-27 (tokens sin `jti`/`ver` → 401; revocación de rol como
mecanismo sin endpoint; refresh 30 días; reuso → revocación completa).

## Pendientes de decisión del humano (previos, no bloquean la puerta del spec)

- **El push sigue sin hacerse.** Forgejo no responde en `127.0.0.1:3000`
  (feature #23, aún sin montar). El remoto `origin` → GitHub no está
  autorizado como destino. Todo el trabajo vive en un solo disco.
- **PA-14** sigue abierta: quién da de alta una inmobiliaria y asigna su
  `codigo`. El PRD menciona el Super Admin pero no define ningún `RF-*` de
  onboarding.
- **Deuda del review de #25 (D-1, D-2):** cuando exista el consumidor de la
  tarifa (módulo de pagos), reescribir el unit test con repositorio real y
  añadir el test de forma SQL para `sujetoDeRetencion`.

## Cola

- **#6** `property_profile` — `pending`, siguiente del orden original.
- El **portal del cliente** (RF-AU2/AU4) no existe como feature y ya bloquea
  cobertura: R18 de #26 solo pudo demostrarse por vías indirectas porque no
  hay ninguna ruta de cliente en el sistema.
