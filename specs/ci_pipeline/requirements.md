# Requirements — ci_pipeline

> Feature #23. Pipeline de integración continua.
> Anclaje al PRD: docs/verification.md (niveles 1–3) y CHECKPOINTS.md
> (C4: `./init.sh` verde es la puerta).

### R1 — (verification.md) El pipeline corre la verificación completa
CUANDO un push o un pull request toca el repositorio, el sistema DEBE
ejecutar en un runner limpio: `npm ci`, `npm run lint`, `npm run
typecheck`, `npm run test`, `npm run test:db` (con Docker/PostgreSQL real)
y `npm run build` — el mismo semáforo de `./init.sh`.

### R2 — (C4) La puerta bloquea
SI cualquiera de los pasos falla ENTONCES el workflow DEBE terminar en
estado fallido y el pull request DEBE quedar bloqueado (check obligatorio).

### R3 — (docs/specs.md) Sin secretos ni saltos
EL workflow NO DEBE contener secretos hardcodeados ni pasos que salten
tests; las credenciales de base de datos son las de prueba (inertes).

## DECISIONES de la puerta
| Id | Decisión |
|---|---|
| PA-23-1 | GitHub Actions (`.github/workflows/ci.yml`) como único pipeline; Forgejo se eliminó por decisión del humano |
| PA-23-2 | `test:db` corre con el servicio `postgres:16-alpine` del runner (Testcontainers ya lo usa) |
