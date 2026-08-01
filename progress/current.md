# Sesión actual

> Este archivo se vacía al cerrar cada sesión y su resumen se mueve a
> `history.md`. Mientras trabajas, **mantenlo actualizado en tiempo real**,
> no al final.

- **Feature en curso:** batch: **#12 y #13 `done`** (review APPROVED),
  **#15 `pwa_offline`** (implementada, 17/17 tasks, esperando **review**),
  **#14 `inventory_signature_pdf`** (spec_ready — después de #15).
- **Agente:** implementer terminó #15 → reviewer (mutaciones) → humano
  autoriza `done` → luego #14.
- **Estado:** meta de la sesión: **completar la fase 1** (1b + 1c + #23).

## UI del proyecto

**NO hay UI real todavía.** `apps/web` es solo el shell de healthcheck del
scaffold (#1); `apps/pwa` no existe; el tablero no tiene features de
frontend. Las features de la fase 1 son backend (API). La PWA de campo
(#15) será el primer cliente real de inventarios.

## Cerradas (17)

#1–#5, #24, #25–#27, #6–#13.

## En review

- **#15 `pwa_offline`** — implementación completa:
  - Suite: `npm run test` **799** (incluye 11 de la PWA) + `npm run test:db` **140**.
  - Lint, typecheck y build (monorepo + PWA) verdes; `./init.sh` exit 0 (22 OK).
  - Trazabilidad R1–R12 → test en `progress/impl_pwa_offline.md`.
  - PA-15-1..4 ejecutadas; E2E de pérdida de conexión, conflicto y sesión.
  - **Errata de #12 corregida:** R6 (RF-I24) estaba incompleto — faltaban
    las 4 rutas de crear/borrar zonas e ítems; añadidas con tests (15
    rutas de inventarios).
- **#14 `inventory_signature_pdf`** — spec_ready (después de #15).

## Pendientes de decisión del humano

1. **El push sigue sin hacerse.** Forgejo no responde en `127.0.0.1:3000`
   (feature #23, aún sin montar). El remoto `origin` → GitHub no está
   autorizado como destino.
2. **PA-14** sigue abierta: quién da de alta una inmobiliaria y asigna su
   `codigo` (no hay RF-* de onboarding).
3. **Deudas de reviews** acumuladas (#25–#11) — ver `history.md`.

## Cola

- **#16–#20** — contratos y póliza (1c).
- **#23** `ci_pipeline` — `pending` (Forgejo sin montar; bloquea el push).
