# Sesión actual

> Este archivo se vacía al cerrar cada sesión y su resumen se mueve a
> `history.md`. Mientras trabajas, **mantenlo actualizado en tiempo real**,
> no al final.

- **Feature en curso:** #23 `ci_pipeline` (fase 1a)
- **Inicio:** 2026-07-26
- **Agente:** implementer

## Plan

Implementar el pipeline de CI con Forgejo self-hosted según `specs/ci_pipeline/`.
29 tasks en bloques A–H. Todos las decisiones DA-1..DA-6 cerradas.

## Bitácora

- `feature_list.json` actualizado a `in_progress`.
- Docker 29.6.2 + Compose 5.3.1 confirmados operativos.
- **Bloques A–E completados** (T1–T21): infraestructura, tests, workflow, scripts.
- `init.sh` verde: 120 tests, lint, typecheck, build.
- **Pendiente:** Bloques F–G (T22–T27) requieren la instancia de Forgejo levantada
  y configuración manual del humano (instalador web, token de API, repository).

## Archivos creados

```
ci/forgejo/.env.example
ci/forgejo/docker-compose.ci.yml
ci/forgejo/config-runner.yml
ci/forgejo/README.md
ci/forgejo/scripts/levantar.sh
ci/forgejo/scripts/registrar-runner.sh
ci/forgejo/scripts/proteger-rama.sh
ci/forgejo/scripts/verificar-ci.sh
.forgejo/workflows/ci.yml
tests/ci-infraestructura.test.ts
tests/ci-flujo-trabajo.test.ts
```

## Archivos modificados

```
.gitignore  (añadido ci/forgejo/.env y ci/forgejo/datos/)
package.json (añadido script ci:verificar)
```

## Próximo paso

T22: Levantar el stack de CI (`bash ci/forgejo/scripts/levantar.sh`), ejecutar el
registro del runner y verificar en la UI que aparece Idle/Online. Requiere que
el humano complete los pasos manuales 3–6 del README (instalador, usuario admin,
token de API, repo, Actions habilitado).

