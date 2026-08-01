# Sesión actual

> Este archivo se vacía al cerrar cada sesión y su resumen se mueve a
> `history.md`. Mientras trabajas, **mantenlo actualizado en tiempo real**,
> no al final.

- **Feature en curso:** #9 `property_intake` — status **`spec_ready`**
- **Agente:** leader → spec_author (3 archivos listos) → ⏸ **HUMANO**
- **Estado:** ⏸ **esperando la aprobación del spec para pasar a
  `in_progress`.** NO se toca código hasta entonces.

## Espec — `specs/property_intake/`

Ingreso de propiedad (RF-PI1..PI3). 14 requirements (R1–R14), 22 tasks
(11 de test). **Sin migración**: el ingreso orquesta perfiles (#5), ficha
(#6), instancia (#8) y transiciones por claves, atómicamente.
`./init.sh` verde (652 + 108 tests) antes de redactar el spec.

## Decisiones técnicas que el humano debe confirmar (design.md §8)

1. **PA-9-1 — RF-PI3 (template de contrato validado) fuera de #9**: es la
   feature #16 (fase 1c). El ingreso termina en el estado correcto; #16
   extenderá el flujo.
2. **PA-9-2 — Contrato físico del escenario B fuera de #9**: es la #18. El
   ingreso asocia inquilino y deja la propiedad en `arrendada`.
3. **PA-9-3 — Reutilización de perfiles por documento con comparación de
   nombre** (criterio `nombresCoinciden` de #26): divergente → 409 sin
   escribir nada.
4. **PA-9-4 — Ingreso atómico**: una sola transacción; cualquier fallo
   (incluida la cadena del escenario B) revierte todo.

## Pendientes de decisión del humano (previos, no bloquean la puerta del spec)

- **El push sigue sin hacerse.** Forgejo no responde en `127.0.0.1:3000`
  (feature #23, aún sin montar). El remoto `origin` → GitHub no está
  autorizado como destino. Todo el trabajo vive en un solo disco.
- **PA-14** sigue abierta: quién da de alta una inmobiliaria y asigna su
  `codigo`. El PRD menciona el Super Admin pero no define ningún `RF-*` de
  onboarding.
- **Deudas de reviews:** #25 D-1/D-2; #26 D-3/D-4; #27 D-1/D-2/D-3; #6
  D-1/D-2/D-3; #7 D-1/D-2/D-3; #8 D-1/D-2/D-3.

## Cola

- **#10** `notifications` — `pending` (consumirá el hook `notificacion` que
  #7 dejó como dato).
- El **portal del cliente** (RF-AU2/AU4) no existe como feature y ya bloquea
  cobertura: R18 de #26 solo pudo demostrarse por vías indirectas porque no
  hay ninguna ruta de cliente en el sistema.
