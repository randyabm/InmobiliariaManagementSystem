# Sesión actual

> Este archivo se vacía al cerrar cada sesión y su resumen se mueve a
> `history.md`. Mientras trabajas, **mantenlo actualizado en tiempo real**,
> no al final.

- **Feature en curso:** **#14 `inventory_signature_pdf`** (implementada,
  22/22 tasks, esperando **review**). #12, #13 y #15 `done`.
- **Agente:** implementer terminó #14 → reviewer (mutaciones) → humano
  autoriza `done`.
- **Estado:** meta de la sesión: **completar la fase 1** (1b + 1c + #23).

## UI del proyecto

**NO hay UI real todavía.** `apps/web` es solo el shell de healthcheck del
scaffold (#1); `apps/pwa` no existe; el tablero no tiene features de
frontend. Las features de la fase 1 son backend (API). La PWA de campo
(#15) será el primer cliente real de inventarios.

## Cerradas (18)

#1–#5, #24, #25–#27, #6–#13, #15.

## En review

- **#14 `inventory_signature_pdf`** — implementación completa:
  - Suite: `npm run test` **821** + `npm run test:db` **143**.
  - Lint, typecheck y build verdes; `./init.sh` exit 0 (22 OK).
  - Trazabilidad R1–R12 → test en `progress/impl_inventory_signature_pdf.md`.
  - PA-14-1..4 ejecutadas; PDF pdf-lib con hash estable, evidencia
    append-only, OTP FIRMA de #13 consumido; vínculo al contrato anotado
    para #17.

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
