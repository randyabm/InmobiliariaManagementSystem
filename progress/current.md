# Sesión actual

> Este archivo se vacía al cerrar cada sesión y su resumen se mueve a
> `history.md`. Mientras trabajas, **mantenlo actualizado en tiempo real**,
> no al final.

- **Feature en curso:** batch: **#12 y #13 `done`** (review APPROVED),
  **#15 `pwa_offline`** (spec_ready → en implementación), **#14
  `inventory_signature_pdf`** (spec_ready — agregada al lote por decisión
  del humano, después de #15).
- **Agente:** implementer → reviewer → humano autorizó #12/#13; ahora
  implementer sobre #15; #14 depende de #13 (OTP FIRMA ya entregado).
- **Estado:** meta de la sesión: **completar la fase 1** (1b + 1c + #23).

## UI del proyecto

**NO hay UI real todavía.** `apps/web` es solo el shell de healthcheck del
scaffold (#1); `apps/pwa` no existe; el tablero no tiene features de
frontend. Las features de la fase 1 son backend (API). La PWA de campo
(#15) será el primer cliente real de inventarios.

## Cerradas (17)

#1–#5, #24, #25–#27, #6–#13.

## En review

- **#15 `pwa_offline`** — spec_ready, a la espera de implementación.
- **#14 `inventory_signature_pdf`** — spec_ready (agregada al lote por el
  humano; depende de #13, que ya entregó el OTP FIRMA).

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
