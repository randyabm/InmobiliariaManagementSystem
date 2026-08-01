# Design — ci_pipeline

## 1. Workflow `.github/workflows/ci.yml`

- trigger: `push` y `pull_request` (rama principal y feature branches).
- runner: `ubuntu-latest`, Node 20, npm ci.
- pasos: lint → typecheck → test → test:db (docker) → build.
- `init.sh` es la versión local del mismo semáforo; el workflow lo
  reproduce paso a paso para mejor granularidad de errores.
- Forgejo fue eliminado por decisión del humano (remote, `.forgejo/`,
  `ci/forgejo/` y sus tests): el CI es exclusivamente GitHub Actions.
