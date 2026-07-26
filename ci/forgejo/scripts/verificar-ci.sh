#!/usr/bin/env bash
# Verifica que la instancia de Forgejo y su CI están configurados correctamente.
# Requiere una instancia en marcha y credenciales en ci/forgejo/.env.
# Ejecutar: npm run ci:verificar
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
  echo "[ERROR] FORGEJO_API_TOKEN no está configurado."
  exit 1
fi

if [ "${FORGEJO_ROOT_URL:-}" = "CHANGE_ME" ] || [ -z "${FORGEJO_ROOT_URL:-}" ]; then
  echo "[ERROR] FORGEJO_ROOT_URL no está configurado."
  exit 1
fi

API="${FORGEJO_ROOT_URL}api/v1"
AUTH="Authorization: token ${FORGEJO_API_TOKEN}"
FALLOS=0

check() {
  local descripcion="$1"
  local resultado="$2"
  if [ "$resultado" = "ok" ]; then
    echo "  [OK] ${descripcion}"
  else
    echo "  [FALLO] ${descripcion}: ${resultado}"
    FALLOS=$((FALLOS + 1))
  fi
}

echo "=== Verificación de CI (Forgejo) ==="
echo ""

# 1. Instancia responde
echo "1. Instancia Forgejo..."
VERSION=$(curl -fsSL "${API}/version" 2>/dev/null || echo "FALLO")
if [ "$VERSION" != "FALLO" ]; then
  check "Versión" "ok"
else
  check "Versión" "No responde en ${FORGEJO_ROOT_URL}"
fi

# Detectar owner/repo
REMOTE_URL=$(git remote get-url origin 2>/dev/null || echo "")
PATH_REPO=$(echo "$REMOTE_URL" | sed -E 's|.*://[^/]+/||; s|\.git$||')
OWNER=$(echo "$PATH_REPO" | cut -d'/' -f1)
REPO=$(echo "$PATH_REPO" | cut -d'/' -f2)

if [ -z "$OWNER" ] || [ -z "$REPO" ]; then
  echo "  [FALLO] No se pudo detectar owner/repo del remote origin."
  exit 1
fi

echo ""
echo "2. Repositorio ${OWNER}/${REPO}..."

# 2. Repositorio existe y tiene Actions habilitado
REPO_INFO=$(curl -fsSL -H "$AUTH" "${API}/repos/${OWNER}/${REPO}" 2>/dev/null || echo "FALLO")
if echo "$REPO_INFO" | python3 -c "import sys,json; d=json.load(sys.stdin); exit(0 if d.get('has_actions') else 1)" 2>/dev/null; then
  check "Repositorio con Actions habilitado" "ok"
else
  check "Repositorio con Actions habilitado" "Actions no está habilitado o el repo no existe"
fi

# 3. Runner online
echo ""
echo "3. Runner..."
RUNNERS=$(curl -fsSL -H "$AUTH" "${API}/admin/runners" 2>/dev/null || echo "[]")
RUNNER_ONLINE=$(echo "$RUNNERS" | python3 -c "
import sys, json
data = json.load(sys.stdin)
runners = data if isinstance(data, list) else data.get('data', [])
for r in runners:
    if r.get('status') == 'online' or r.get('online'):
        print('si')
        break
else:
    print('no')
" 2>/dev/null || echo "no")

if [ "$RUNNER_ONLINE" = "si" ]; then
  check "Al menos un runner online" "ok"
else
  check "Al menos un runner online" "Ningún runner online encontrado"
fi

# 4. Protección de rama main
echo ""
echo "4. Protección de rama main..."
PROTECCIONES=$(curl -fsSL -H "$AUTH" "${API}/repos/${OWNER}/${REPO}/branch_protections" 2>/dev/null || echo "[]")

PROTECTOR_DATA=$(echo "$PROTECCIONES" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for p in data:
    if p.get('branch_name') == 'main' or p.get('rule_name') == 'main':
        sc = p.get('enable_status_check', False)
        ctx = p.get('status_check_contexts', [])
        push = p.get('enable_push', True)
        approvals = p.get('required_approvals', -1)
        print(f'{sc}|{len(ctx)}|{push}|{approvals}')
        break
else:
    print('no_encontrado')
" 2>/dev/null || echo "no_encontrado")

if [ "$PROTECTOR_DATA" = "no_encontrado" ]; then
  check "Protección de main" "No se encontró protección para main"
else
  IFS='|' read -r SC_COUNT ctx_count push approvals <<< "$PROTECTOR_DATA"
  if [ "$SC_COUNT" = "True" ] || [ "$SC_COUNT" = "true" ]; then
    check "Status checks habilitados" "ok"
  else
    check "Status checks habilitados" "enable_status_check es false"
  fi

  if [ "$ctx_count" -gt 0 ] 2>/dev/null; then
    check "Contextos requeridos no vacíos" "ok"
  else
    check "Contextos requeridos no vacíos" "0 contextos configurados"
  fi

  if [ "$push" = "False" ] || [ "$push" = "false" ]; then
    check "Push directo bloqueado" "ok"
  else
    check "Push directo bloqueado" "enable_push es true"
  fi

  if [ "$approvals" = "0" ]; then
    check "Aprobaciones requeridas: 0" "ok"
  else
    check "Aprobaciones requeridas: 0" "required_approvals = ${approvals}"
  fi
fi

# 5. Espejo push hacia GitHub
echo ""
echo "5. Espejo push hacia GitHub..."
MIRRORS=$(curl -fsSL -H "$AUTH" "${API}/repos/${OWNER}/${REPO}/push_mirrors" 2>/dev/null || echo "[]")
PUSH_MIRROR=$(echo "$MIRRORS" | python3 -c "
import sys, json
data = json.load(sys.stdin)
mirrors = data if isinstance(data, list) else data.get('data', [])
for m in mirrors:
    remote = m.get('remote_addr', '')
    if 'github.com' in remote:
        print('si')
        break
else:
    print('no')
" 2>/dev/null || echo "no")

if [ "$PUSH_MIRROR" = "si" ]; then
  check "Espejo push hacia GitHub configurado" "ok"
else
  check "Espejo push hacia GitHub configurado" "No se encontró espejo push a GitHub"
fi

# Resumen
echo ""
if [ "$FALLOS" -eq 0 ]; then
  echo "=== TODAS LAS VERIFICACIONES PASARON ==="
  exit 0
else
  echo "=== ${FALLOS} VERIFICACIONES FALLARON ==="
  exit 1
fi
