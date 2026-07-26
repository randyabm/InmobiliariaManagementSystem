#!/usr/bin/env bash
# Registra el runner contra la instancia de Forgejo.
# El token se genera y consume en la misma tubería, sin escribirlo en disco.
# Ejecutar después de levantar el stack y completar el instalador web.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="${COMPOSE_DIR}/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "[ERROR] Falta ${ENV_FILE}."
  exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"

if [ "${FORGEJO_API_TOKEN:-}" = "CHANGE_ME" ] || [ -z "${FORGEJO_API_TOKEN:-}" ]; then
  echo "[ERROR] FORGEJO_API_TOKEN no está configurado en .env."
  echo "Genera el token en la UI: Settings > Applications > Generate Token"
  echo "Permisos: repository: Read and Write, admin: Read and Write"
  exit 1
fi

if [ "${FORGEJO_ROOT_URL:-}" = "CHANGE_ME" ] || [ -z "${FORGEJO_ROOT_URL:-}" ]; then
  echo "[ERROR] FORGEJO_ROOT_URL no está configurado en .env."
  exit 1
fi

COMPOSE_CMD="docker compose --env-file ${ENV_FILE} -f ${COMPOSE_DIR}/docker-compose.ci.yml"

echo "[1/3] Generando token de registro del runner..."
TOKEN=$($COMPOSE_CMD exec -T forgejo forgejo forgejo-cli actions generate-runner-token 2>/dev/null | tail -1)

if [ -z "$TOKEN" ]; then
  echo "[ERROR] No se pudo generar el token. ¿Forgejo está levantado y el instalador completado?"
  exit 1
fi

echo "[2/3] Registrando runner '${RUNNER_NOMBRE:-local-docker}'..."
$COMPOSE_CMD exec -T runner forgejo-runner register \
  --no-interactive \
  --instance "${FORGEJO_ROOT_URL}" \
  --token "$TOKEN" \
  --name "${RUNNER_NOMBRE:-local-docker}" \
  --labels "${RUNNER_ETIQUETAS:-[\"host\"]}" \
  --config /data/.runner

echo "[3/3] Runner registrado. Verifica en la UI:"
echo "  Site Administration > Actions > Runners > debe aparecer Idle/Online"

# Limpiar la variable del proceso
unset TOKEN
