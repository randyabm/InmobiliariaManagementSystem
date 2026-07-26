#!/usr/bin/env bash
# Configura la protección de la rama main en la instancia de Forgejo.
# Idempotente: volver a ejecutarlo converge al mismo estado.
# CONTEXTOS_REQUERIDOS se declara como constante para que tests de T19 puedan leerlo.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="${COMPOSE_DIR}/.env"

# Contextos de status requeridos — debe coincidir con los ids de job en ci.yml
CONTEXTOS_REQUERIDOS=(
  "calidad"
  "base-de-datos"
  "arnes"
)

if [ ! -f "$ENV_FILE" ]; then
  echo "[ERROR] Falta ${ENV_FILE}."
  exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"

if [ "${FORGEJO_API_TOKEN:-}" = "CHANGE_ME" ] || [ -z "${FORGEJO_API_TOKEN:-}" ]; then
  echo "[ERROR] FORGEJO_API_TOKEN no está configurado."
  exit 1
fi

if [ "${FORGEJO_ROOT_URL:-}" = "CHANGE_ME" ] || [ -z "${FORGEJO_ROOT_URL:-}" ]; then
  echo "[ERROR] FORGEJO_ROOT_URL no está configurado."
  exit 1
fi

# Detectar owner y repo del origin local
REMOTE_URL=$(git remote get-url origin 2>/dev/null || echo "")
if [ -z "$REMOTE_URL" ]; then
  echo "[ERROR] No se detectó un remote 'origin'."
  exit 1
fi

# Extraer owner/repo de URLs tipo http://127.0.0.1:3000/user/InmobiliariaManagementSystem.git
# o http://127.0.0.1:3000/user/InmobiliariaManagementSystem
PATH_REPO=$(echo "$REMOTE_URL" | sed -E 's|.*://[^/]+/||; s|\.git$||')
OWNER=$(echo "$PATH_REPO" | cut -d'/' -f1)
REPO=$(echo "$PATH_REPO" | cut -d'/' -f2)

if [ -z "$OWNER" ] || [ -z "$REPO" ]; then
  echo "[ERROR] No se pudo extraer owner/repo de ${REMOTE_URL}"
  exit 1
fi

API="${FORGEJO_ROOT_URL}api/v1"
AUTH="Authorization: token ${FORGEJO_API_TOKEN}"

echo "Protegiendo rama main en ${OWNER}/${REPO}..."

# Serializar contextos requeridos como array JSON
CONTEXTOS_JSON="["
for i in "${!CONTEXTOS_REQUERIDOS[@]}"; do
  [ "$i" -gt 0 ] && CONTEXTOS_JSON+=","
  CONTEXTOS_JSON+="\"${CONTEXTOS_REQUERIDOS[$i]}\""
done
CONTEXTOS_JSON+="]"

# Verificar si ya existe una protección para main
EXISTING=$(curl -fsSL \
  -H "$AUTH" \
  "${API}/repos/${OWNER}/${REPO}/branch_protections" 2>/dev/null || echo "[]")

EXISTING_ID=$(echo "$EXISTING" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for p in data:
    if p.get('branch_name') == 'main':
        print(p.get('id', ''))
        break
" 2>/dev/null || echo "")

BODY=$(cat <<EOF
{
  "branch_name": "main",
  "enable_push": false,
  "enable_status_check": true,
  "status_check_contexts": ${CONTEXTOS_JSON},
  "block_on_outdated_branch": true,
  "required_approvals": 0,
  "enable_approvals_whitelist": false
}
EOF
)

if [ -n "$EXISTING_ID" ]; then
  echo "Actualizando protección existente (id: ${EXISTING_ID})..."
  curl -fsSL -X PATCH \
    -H "$AUTH" \
    -H "Content-Type: application/json" \
    -d "$BODY" \
    "${API}/repos/${OWNER}/${REPO}/branch_protections/${EXISTING_ID}"
else
  echo "Creando nueva protección para main..."
  curl -fsSL -X POST \
    -H "$AUTH" \
    -H "Content-Type: application/json" \
    -d "$BODY" \
    "${API}/repos/${OWNER}/${REPO}/branch_protections"
fi

echo ""
echo "Protección configurada:"
echo "  - Push directo a main: BLOQUEADO"
echo "  - Status checks requeridos: ${CONTEXTOS_REQUERIDOS[*]}"
echo "  - Aprobaciones requeridas: 0"
echo ""
echo "Verificar en la UI: Settings > Branches > Protected Branches"
