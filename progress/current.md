# Sesión actual

> Este archivo se vacía al cerrar cada sesión y su resumen se mueve a
> `history.md`. Mientras trabajas, **mantenlo actualizado en tiempo real**,
> no al final.

- **Feature en curso:** specs del roadmap post-Fase 1 escritas (#29–#33,
  `spec_ready`, esperando la puerta humana).
- **Agente:** líder autónomo.
- **Estado:** FASE 1 COMPLETA (27/27 done); 5 features nuevas en el
  tablero con spec (papel, pagos, mantenimiento, embebido, asistente).

## UI del proyecto

**NO hay UI real todavía.** `apps/web` es solo el shell de healthcheck del
scaffold (#1); `apps/pwa` no existe; el tablero no tiene features de
frontend. Las features de la fase 1 son backend (API). La PWA de campo
(#15) será el primer cliente real de inventarios.

## En cola (spec_ready, puerta humana)

- **#29** `inventory_paper_format` (Fase 2) · **#30** `payment_reconciliation`
  (Fase 3) · **#31** `maintenance_incidents` (Fase 3) · **#32**
  `web_embedding` (Fase 3-4) · **#33** `ai_assistant` (Fase 4+).

## Línea base final

`./init.sh` exit 0 (22 OK) · `test` **871** · `test:db` **143** · lint/
typecheck/build verdes. Resumen en `progress/impl_fase1_cierre.md` y
`progress/history.md`.

## Cerradas (27/27)

#1–#27: core, hojas de vida, dashboard, ingreso, workflows, notificaciones,
inventarios (#6–#15), contratos y póliza (#16–#20), comparación y
versionado (#21–#22), CI (#23).

## Pendientes de decisión del humano

1. **El push sigue sin hacerse.** El remoto `origin` → GitHub no está
   autorizado como destino.
2. **PA-14** sigue abierta: quién da de alta una inmobiliaria y asigna su
   `codigo` (no hay RF-* de onboarding).
3. **Deudas de reviews** acumuladas (#25–#11) — ver `history.md`.

## Cola

- **#16–#20** — contratos y póliza (1c).
- **#23** `ci_pipeline` — `done` (GitHub Actions; Forgejo eliminado por
   decisión del humano).
