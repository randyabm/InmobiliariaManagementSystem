#!/usr/bin/env bash
# Levanta el stack de CI (Forgejo + runner + dind).
# Ejecutar desde la raíz del repo: bash ci/forgejo/scripts/levantar.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="${COMPOSE_DIR}/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "[ERROR] Falta ${ENV_FILE}. Copia .env.example a .env y rellena los valores."
  echo "  cp ci/forgejo/.env.example ci/forgejo/.env"
  exit 1
fi

echo "[1/3] Levantando stack de CI..."
docker compose --env-file "$ENV_FILE" -f "${COMPOSE_DIR}/docker-compose.ci.yml" up -d

echo "[2/3] Esperando a que Forgejo responda..."
MAX_INTENTOS=30
INTENTO=0
while ! docker compose --env-file "$ENV_FILE" -f "${COMPOSE_DIR}/docker-compose.ci.yml" exec -T forgejo curl -fsSL http://localhost:3000/api/v1/version >/dev/null 2>&1; do
  INTENTO=$((INTENTO + 1))
  if [ "$INTENTO" -ge "$MAX_INTENTOS" ]; then
    echo "[ERROR] Forgejo no responde tras ${MAX_INTENTOS} intentos."
    docker compose --env-file "$ENV_FILE" -f "${COMPOSE_DIR}/docker-compose.ci.yml" logs --tail=20 forgejo
    exit 1
  fi
  sleep 2
done

VERSION=$(docker compose --env-file "$ENV_FILE" -f "${COMPOSE_DIR}/docker-compose.ci.yml" exec -T forgejo curl -fsSL http://localhost:3000/api/v1/version)
echo "[3/3] Forgejo respondió: ${VERSION}"
echo ""
echo "Stack de CI levantado. Siguiente paso: completar el instalador web en"
echo "  http://127.0.0.1:${FORGEJO_HTTP_PORT:-3000}"
