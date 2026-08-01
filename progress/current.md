# Sesión actual

> Este archivo se vacía al cerrar cada sesión y su resumen se mueve a
> `history.md`. Mientras trabajas, **mantenlo actualizado en tiempo real**,
> no al final.

- **Feature en curso:** #8 `property_lifecycle` — status **`in_progress`**
- **Agente:** leader → spec_author → implementer → **reviewer (APROBADO)**
- **Estado:** ⏸ **esperando que el humano autorice marcarla `done`.**

## Estado de la verificación

`./init.sh` exit 0 — `npm run test` **652** (67 archivos) y `npm run test:db`
**108** (3 archivos). Lint, typecheck y build verdes. **Sin migración.**

24/24 tasks. Veredicto en `progress/review_property_lifecycle.md`:
**APROBADO, sin bloqueantes**. El reviewer reprodujo cinco mutaciones del
implementer: 3 con rojos (4/5 vínculo, 1/5 precedencia, 1/5 envoltura) y 2
de defensa en profundidad verificadas con 0 rojos (extractor de auditoría
redundante con `params.id`; aislamiento del dashboard sostenido por el RLS).

## Espec

`specs/property_lifecycle/` — aprobado por el humano con las cuatro
decisiones PA-8 (estado solo en el motor; instancia al crear la propiedad;
copia TENANT o SISTEMA; rutas de negocio que envuelven al motor).

## Pendientes de decisión del humano (previos, no bloquean la puerta del spec)

- **El push sigue sin hacerse.** Forgejo no responde en `127.0.0.1:3000`
  (feature #23, aún sin montar). El remoto `origin` → GitHub no está
  autorizado como destino. Todo el trabajo vive en un solo disco.
- **PA-14** sigue abierta: quién da de alta una inmobiliaria y asigna su
  `codigo`. El PRD menciona el Super Admin pero no define ningún `RF-*` de
  onboarding.
- **Deudas de reviews:** #25 D-1/D-2; #26 D-3/D-4; #27 D-1/D-2/D-3; #6
  D-1/D-2/D-3; #7 D-1/D-2/D-3.

## Cola

- **#9** `property_intake` — `pending` (ingreso con creación en línea,
  RF-PI1..PI3).
- El **portal del cliente** (RF-AU2/AU4) no existe como feature y ya bloquea
  cobertura: R18 de #26 solo pudo demostrarse por vías indirectas porque no
  hay ninguna ruta de cliente en el sistema.
