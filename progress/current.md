# Sesión actual

> Este archivo se vacía al cerrar cada sesión y su resumen se mueve a
> `history.md`. Mientras trabajas, **mantenlo actualizado en tiempo real**,
> no al final.

- **Feature en curso:** resto de la fase 1 por orden del humano (sin pedir
  review ni aprobación): **#16-#20** (contratos y póliza, 1c), **#21-#22**
  (comparación y versionado de inventarios), **#23** (CI). #12-#15 `done`.
- **Agente:** leader → spec_author → implementer → reviewer, todo
  autónomo; el humano autorizó el cierre sin puertas.
- **Estado:** meta de la sesión: **completar la fase 1** (1b + 1c + #23).

## UI del proyecto

**NO hay UI real todavía.** `apps/web` es solo el shell de healthcheck del
scaffold (#1); `apps/pwa` no existe; el tablero no tiene features de
frontend. Las features de la fase 1 son backend (API). La PWA de campo
(#15) será el primer cliente real de inventarios.

## En cola (resto de la fase 1, autónomo)

- **#16-#20** — contratos y póliza (1c): templates, generación+firma,
  digitalización, renovaciones/alertas, póliza.
- **#21-#22** — comparación y versionado de inventarios (1b pendiente).
- **#23** — CI pipeline (Forgejo sin montar; documentar la decisión).

## Cerradas (19)

#1–#5, #24, #25–#27, #6–#15.

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
