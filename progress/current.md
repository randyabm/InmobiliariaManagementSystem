# Sesión actual

> Este archivo se vacía al cerrar cada sesión y su resumen se mueve a
> `history.md`. Mientras trabajas, **mantenlo actualizado en tiempo real**,
> no al final.

- **Feature en curso:** batch **#12 `inventory_creation`**, **#13
  `inventory_tenant_review`** y **#15 `pwa_offline`** — status
  **`spec_ready`** (los tres) → ⏸ **puerta humana (una sola)**.
- **Agente:** leader → spec_author (3 specs listos) → ⏸ **HUMANO** →
  implementer → reviewer.
- **Estado:** meta de la sesión: **completar la fase 1** (1b + 1c + #23).

## UI del proyecto

**NO hay UI real todavía.** `apps/web` es solo el shell de healthcheck del
scaffold (#1); `apps/pwa` no existe; el tablero no tiene features de
frontend. Las features de la fase 1 son backend (API). La PWA de campo
(#15) será el primer cliente real de inventarios.

## Cerradas (15)

#1–#5, #24, #25–#27, #6–#11.

## Pendientes de decisión del humano

1. **El push sigue sin hacerse.** Forgejo no responde en `127.0.0.1:3000`
   (feature #23, aún sin montar). El remoto `origin` → GitHub no está
   autorizado como destino.
2. **PA-14** sigue abierta: quién da de alta una inmobiliaria y asigna su
   `codigo` (no hay RF-* de onboarding).
3. **Deudas de reviews** acumuladas (#25–#11) — ver `history.md`.

## Cola

- **#14** `inventory_signature_pdf` — después del lote.
- **#16–#20** — contratos y póliza (1c).
- **#23** `ci_pipeline` — `pending` (Forgejo sin montar; bloquea el push).
