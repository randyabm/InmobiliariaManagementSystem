# Sesión actual

> Este archivo se vacía al cerrar cada sesión y su resumen se mueve a
> `history.md`. Mientras trabajas, **mantenlo actualizado en tiempo real**,
> no al final.

- **Feature en curso:** #29–#33 implementadas (`done`) tras la aprobación
  del humano. Fase 1 (27) + Fase 2/3/4 parcial = **33/33 done**.
- **Agente:** líder autónomo.
- **Estado:** roadmap completo: papel (#29), pagos (#30), mantenimiento
  (#31), embebido (#32), asistente (#33).

## UI del proyecto

**NO hay UI real todavía.** `apps/web` es solo el shell de healthcheck del
scaffold (#1); `apps/pwa` no existe; el tablero no tiene features de
frontend. Las features de la fase 1 son backend (API). La PWA de campo
(#15) será el primer cliente real de inventarios.

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
