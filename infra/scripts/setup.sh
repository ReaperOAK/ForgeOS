#!/usr/bin/env bash
# =============================================================================
# ForgeOS — Development Environment Setup
# =============================================================================
# Checks that all required tools are installed, creates a .env file from the
# template if one doesn't exist, installs Node.js dependencies, and verifies
# that Docker services can be reached.
#
# Usage:
#   bash infra/scripts/setup.sh
#   make setup
#
# Ticket: FORGEOS-DO003
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Colours
# ---------------------------------------------------------------------------
if [[ -t 1 ]]; then
  GREEN='\033[32m'
  YELLOW='\033[33m'
  RED='\033[31m'
  CYAN='\033[36m'
  RESET='\033[0m'
else
  GREEN='' YELLOW='' RED='' CYAN='' RESET=''
fi

ok()   { printf "${GREEN}  ✔ %s${RESET}\n" "$1"; }
warn() { printf "${YELLOW}  ⚠  %s${RESET}\n" "$1"; }
fail() { printf "${RED}  ✘ %s${RESET}\n" "$1"; }

ERRORS=0

# ---------------------------------------------------------------------------
# Prerequisite Checks
# ---------------------------------------------------------------------------
printf "${CYAN}ForgeOS — Development Environment Setup${RESET}\n\n"
printf "Checking prerequisites …\n\n"

# Docker
if command -v docker >/dev/null 2>&1; then
  DOCKER_VERSION=$(docker --version | grep -oP '\d+\.\d+\.\d+' | head -1)
  ok "Docker ${DOCKER_VERSION}"
else
  fail "Docker is not installed. Install from https://docs.docker.com/get-docker/"
  ERRORS=$((ERRORS + 1))
fi

# Docker Compose (v2 plugin)
if docker compose version >/dev/null 2>&1; then
  COMPOSE_VERSION=$(docker compose version --short 2>/dev/null || docker compose version | grep -oP '\d+\.\d+\.\d+' | head -1)
  ok "Docker Compose ${COMPOSE_VERSION}"
else
  fail "Docker Compose v2 is not installed. Install the docker-compose-plugin package."
  ERRORS=$((ERRORS + 1))
fi

# Node.js (>= 22)
if command -v node >/dev/null 2>&1; then
  NODE_VERSION=$(node --version | tr -d 'v')
  NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
  if [[ "$NODE_MAJOR" -ge 22 ]]; then
    ok "Node.js v${NODE_VERSION}"
  else
    warn "Node.js v${NODE_VERSION} found but >= 22 required"
    ERRORS=$((ERRORS + 1))
  fi
else
  fail "Node.js is not installed. Install v22+ from https://nodejs.org/"
  ERRORS=$((ERRORS + 1))
fi

# npm
if command -v npm >/dev/null 2>&1; then
  ok "npm $(npm --version)"
else
  fail "npm is not available. It should ship with Node.js."
  ERRORS=$((ERRORS + 1))
fi

# Python 3
if command -v python3 >/dev/null 2>&1; then
  PYTHON_VERSION=$(python3 --version | awk '{print $2}')
  ok "Python ${PYTHON_VERSION}"
else
  warn "Python 3 is not installed. Some tooling (tickets.py, mcp-server) requires it."
fi

# Git
if command -v git >/dev/null 2>&1; then
  ok "Git $(git --version | awk '{print $3}')"
else
  fail "Git is not installed."
  ERRORS=$((ERRORS + 1))
fi

# Make
if command -v make >/dev/null 2>&1; then
  ok "Make $(make --version | head -1 | grep -oP '\d+\.\d+' | head -1)"
else
  warn "GNU Make is not installed. Install via your package manager."
fi

printf "\n"

# ---------------------------------------------------------------------------
# Summary of prerequisite check
# ---------------------------------------------------------------------------
if [[ "$ERRORS" -gt 0 ]]; then
  printf "${RED}✘ ${ERRORS} required tool(s) missing. Please install them and re-run setup.${RESET}\n\n"
  exit 1
fi

printf "${GREEN}All prerequisites satisfied.${RESET}\n\n"

# ---------------------------------------------------------------------------
# Environment File
# ---------------------------------------------------------------------------
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [[ ! -f "${REPO_ROOT}/infra/.env" ]]; then
  if [[ -f "${REPO_ROOT}/infra/.env.template" ]]; then
    cp "${REPO_ROOT}/infra/.env.template" "${REPO_ROOT}/infra/.env"
    ok "Created infra/.env from template (review and adjust values)"
  else
    warn "No .env.template found — skipping .env creation"
  fi
else
  ok "infra/.env already exists"
fi

# ---------------------------------------------------------------------------
# Node.js Dependencies
# ---------------------------------------------------------------------------
printf "\nInstalling Node.js dependencies …\n"

if [[ -f "${REPO_ROOT}/forgeos-server/package.json" ]]; then
  cd "${REPO_ROOT}/forgeos-server"
  npm ci --prefer-offline 2>/dev/null || npm install
  ok "forgeos-server dependencies installed"
  cd "${REPO_ROOT}"
else
  warn "forgeos-server/package.json not found — skipping npm install"
fi

# ---------------------------------------------------------------------------
# Docker Secrets
# ---------------------------------------------------------------------------
SECRETS_DIR="${REPO_ROOT}/forgeos-server/secrets"
if [[ ! -f "${SECRETS_DIR}/db_password" ]]; then
  mkdir -p "${SECRETS_DIR}"
  echo "changeme_db_password" > "${SECRETS_DIR}/db_password"
  warn "Created default db_password secret — change before production use"
else
  ok "Database password secret exists"
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
printf "\n${GREEN}╔════════════════════════════════════════════════╗${RESET}\n"
printf "${GREEN}║  ForgeOS setup complete!                       ║${RESET}\n"
printf "${GREEN}║                                                ║${RESET}\n"
printf "${GREEN}║  Next steps:                                   ║${RESET}\n"
printf "${GREEN}║    make up        — Start services             ║${RESET}\n"
printf "${GREEN}║    make migrate   — Apply migrations           ║${RESET}\n"
printf "${GREEN}║    make seed      — Load sample data           ║${RESET}\n"
printf "${GREEN}║    make help      — Show all targets           ║${RESET}\n"
printf "${GREEN}╚════════════════════════════════════════════════╝${RESET}\n\n"
