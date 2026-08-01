# Sesión actual

> Este archivo se vacía al cerrar cada sesión y su resumen se mueve a
> `history.md`. Mientras trabajas, **mantenlo actualizado en tiempo real**,
> no al final.

- **Feature en curso:** #25 `retencion_codeudor_referencias` — status
  **`in_progress`**
- **Agente:** leader → spec_author → implementer (T1–T27, **completas**) →
  ⏸ **reviewer**
- **Estado:** esperando el review. Informe en
  `progress/impl_retencion_codeudor_referencias.md`.

## Espec

`specs/retencion_codeudor_referencias/` — sin decisiones de producto
pendientes. Dependencia dura #5 satisfecha. Tarifa por tenant/año (D-2) y
codeudores/referencias como captura de datos (D-6).

## Pendientes de decisión del humano (no bloquean #25)

1. **El push sigue sin hacerse.** Forgejo no responde en `127.0.0.1:3000`
   (feature #23, aún sin montar). El remoto `origin` → GitHub no está
   autorizado como destino. Todo el trabajo vive en un solo disco.
2. **PA-14** sigue abierta: quién da de alta una inmobiliaria y asigna su
   `codigo`. El PRD menciona el Super Admin pero no define ningún `RF-*` de
   onboarding.

## Cola

- **#27** `sesion_y_revocacion` — `pending`, sin spec todavía.
- **#6** `property_profile` — `pending`, siguiente del orden original.
- El **portal del cliente** (RF-AU2/AU4) no existe como feature y ya bloquea
  cobertura: R18 de #26 solo pudo demostrarse por vías indirectas porque no
  hay ninguna ruta de cliente en el sistema.
