#!/usr/bin/env bash
# init.sh — Verificación e inicialización del entorno
#
# Este script lo ejecuta el agente al COMENZAR una sesión y antes de
# declarar cualquier feature como `done`. Si falla, la sesión no debe avanzar.
#
# Diseñado para ser verde también en fase 0 (repo sin código todavía):
# los pasos de build/test se omiten limpiamente si aún no existe el proyecto.

set -u
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

ok()   { printf "${GREEN}[OK]${NC}    %s\n" "$1"; }
warn() { printf "${YELLOW}[WARN]${NC}  %s\n" "$1"; }
fail() { printf "${RED}[FAIL]${NC}  %s\n" "$1"; }
skip() { printf "${YELLOW}[SKIP]${NC}  %s\n" "$1"; }

EXIT_CODE=0

echo "── 1. Verificando entorno ─────────────────────────────"

if ! command -v node >/dev/null 2>&1; then
  fail "node no está instalado (se requiere Node.js >= 20)"
  exit 1
fi
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 20 ]; then
  fail "Se requiere Node.js >= 20 (detectado $(node --version))"
  exit 1
fi
ok "node -> $(node --version)"

if command -v pnpm >/dev/null 2>&1; then
  ok "pnpm -> $(pnpm --version)"
elif command -v npm >/dev/null 2>&1; then
  warn "pnpm no encontrado; se usará npm -> $(npm --version)"
else
  fail "No hay gestor de paquetes (pnpm o npm)"
  exit 1
fi

# Docker es necesario para Testcontainers (tests de RLS) y para el stack local.
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  ok "docker disponible (requerido por Testcontainers)"
else
  warn "docker no disponible — los tests de base de datos real no podrán ejecutarse"
fi

echo ""
echo "── 2. Verificando archivos base del arnés ──────────────"

for f in AGENTS.md CLAUDE.md CHECKPOINTS.md feature_list.json progress/current.md \
         docs/PRD.md docs/architecture.md docs/conventions.md docs/specs.md docs/verification.md; do
  if [ ! -f "$f" ]; then
    fail "Falta archivo base: $f"
    EXIT_CODE=1
  else
    ok "Existe $f"
  fi
done

echo ""
echo "── 3. Validando feature_list.json y specs ─────────────"

node - <<'JS'
const fs = require('fs');
const path = require('path');

try {
  const data = JSON.parse(fs.readFileSync('feature_list.json', 'utf8'));
  const valid = new Set(['pending', 'spec_ready', 'in_progress', 'done', 'blocked']);
  const requiresSpec = new Set(['spec_ready', 'in_progress', 'done']);

  const features = data.features || [];
  const inProgress = features.filter(f => f.status === 'in_progress');
  if (inProgress.length > 1) {
    console.log(`[FAIL]  Hay ${inProgress.length} features en in_progress (máximo 1)`);
    process.exit(1);
  }

  const ids = new Set();
  const specErrors = [];
  for (const f of features) {
    if (!valid.has(f.status)) {
      console.log(`[FAIL]  Estado inválido en feature ${f.id}: ${f.status}`);
      process.exit(1);
    }
    if (ids.has(f.id)) {
      console.log(`[FAIL]  id duplicado en feature_list.json: ${f.id}`);
      process.exit(1);
    }
    ids.add(f.id);

    if (f.sdd && requiresSpec.has(f.status)) {
      const dir = path.join('specs', f.name);
      for (const fname of ['requirements.md', 'design.md', 'tasks.md']) {
        if (!fs.existsSync(path.join(dir, fname))) {
          specErrors.push(`feature ${f.id} (${f.name}) en ${f.status} sin ${dir}/${fname}`);
        }
      }
    }
  }

  if (specErrors.length) {
    for (const e of specErrors) console.log(`[FAIL]  ${e}`);
    process.exit(1);
  }

  const done = features.filter(f => f.status === 'done').length;
  console.log(`[OK]    feature_list.json válido (${features.length} features, ${done} done)`);
  console.log(`[OK]    Specs presentes para features sdd con estado no-pending`);
} catch (e) {
  console.log(`[FAIL]  feature_list.json o specs inválidos: ${e.message}`);
  process.exit(1);
}
JS

if [ $? -ne 0 ]; then EXIT_CODE=1; fi

echo ""
echo "── 4. Verificando que no haya secretos commiteados ─────"

# Heurística simple: patrones de credenciales en archivos versionables.
SECRET_HITS=$(grep -rIn --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist \
  --exclude='*.example' --exclude='init.sh' \
  -E '(sk-ant-[A-Za-z0-9_-]{10,}|BEGIN (RSA|OPENSSH) PRIVATE KEY|password[[:space:]]*=[[:space:]]*["'"'"'][^"'"'"']{6,})' \
  . 2>/dev/null | head -5)

if [ -n "$SECRET_HITS" ]; then
  fail "Posibles secretos en el repositorio:"
  echo "$SECRET_HITS"
  EXIT_CODE=1
else
  ok "Sin secretos evidentes en el repositorio"
fi

echo ""
echo "── 4b. Verificando JWT_SECRET ─────────────────────────"

if [ ! -f ".env" ]; then
  warn ".env no existe — copiando desde .env.example"
  cp .env.example .env
fi

if grep -q '^JWT_SECRET=CHANGE_ME' .env 2>/dev/null || ! grep -q '^JWT_SECRET=' .env 2>/dev/null; then
  NEW_SECRET=$(openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | od -An -tx1 | tr -d ' \n' | head -c 64)
  # Reemplazar JWT_SECRET=CHANGE_ME o añadir si falta
  if grep -q '^JWT_SECRET=' .env; then
    sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${NEW_SECRET}|" .env
  else
    echo "JWT_SECRET=${NEW_SECRET}" >> .env
  fi
  ok "JWT_SECRET generado y guardado en .env"
else
  ok "JWT_SECRET ya configurado en .env"
fi

echo ""
echo "── 5. Lint, typecheck y tests ──────────────────────────"

if [ ! -f "package.json" ]; then
  skip "package.json no existe todavía (fase 0 — sin código aún)"
else
  if command -v pnpm >/dev/null 2>&1; then PM=pnpm; else PM=npm; fi

  if [ ! -d "node_modules" ]; then
    warn "node_modules no existe — ejecuta '$PM install' antes de trabajar"
  fi

  run_script () {
    local name="$1"
    if node -e "process.exit(require('./package.json').scripts?.['$name'] ? 0 : 1)" 2>/dev/null; then
      echo "→ $PM run $name"
      if $PM run "$name" 2>&1; then
        ok "$name pasa"
      else
        fail "$name falla"
        EXIT_CODE=1
      fi
    else
      skip "script '$name' no definido en package.json"
    fi
  }

  run_script lint
  run_script typecheck
  run_script test

  # `test:db` es parte del semáforo, no un extra opcional (R56 de
  # specs/owner_tenant_profiles/).
  #
  # Por qué: los invariantes de seguridad del proyecto —aislamiento por
  # tenant_id con RLS real, inmutabilidad de la auditoría, forma de las
  # migraciones— NO se pueden demostrar sin PostgreSQL de verdad, así que
  # viven en `apps/api/test/db/` y fuera de `npm run test` (que es
  # determinista y no abre contenedores). Mientras esa suite estuvo fuera de
  # esta puerta, cuatro tests de políticas RLS llevaban rotos desde las
  # features #2 y #3 —consultaban `pg_policies.polname`, una columna que no
  # existe— sin que nadie lo viera, y la puerta seguía en verde. Esa es la
  # causa de fondo del rechazo de la feature #5.
  #
  # Si Docker no está disponible, esta suite FALLA con un motivo explícito
  # (`test/support/docker-guard.ts`) en vez de omitirse: un verde sin base de
  # datos sería falso (docs/verification.md Nivel 2, CHECKPOINTS.md §C4).
  run_script test:db
fi

echo ""
echo "── 6. Resumen ──────────────────────────────────────────"

if [ $EXIT_CODE -eq 0 ]; then
  ok "Entorno listo. Puedes empezar a trabajar."
else
  fail "Entorno NO está listo. Resuelve los errores antes de avanzar."
fi

exit $EXIT_CODE
