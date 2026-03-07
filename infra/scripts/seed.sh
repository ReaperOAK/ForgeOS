#!/usr/bin/env bash
# =============================================================================
# ForgeOS — Database Seed Script
# =============================================================================
# Wrapper that loads sample ticket data into the ForgeOS database by running
# the TypeScript seed module inside the running MCP server container.
#
# Can also import ticket JSON files from the repository's .github/tickets/
# directory when the import-tickets script is available.
#
# Usage:
#   bash infra/scripts/seed.sh          # Run seed via Docker container
#   bash infra/scripts/seed.sh --local  # Run seed directly (requires DB access)
#   make seed                           # Recommended
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
  RESET='\033[0m'
else
  GREEN='' YELLOW='' RED='' RESET=''
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_BASE="${REPO_ROOT}/infra/docker-compose.yml"
COMPOSE_DEV="${REPO_ROOT}/infra/docker-compose.dev.yml"
COMPOSE_CMD="docker compose -f ${COMPOSE_BASE} -f ${COMPOSE_DEV}"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
check_services() {
  if ! ${COMPOSE_CMD} ps --status running 2>/dev/null | grep -q "mcp-server\|postgres"; then
    printf "${RED}✘ Services are not running. Start them first with: make up${RESET}\n"
    exit 1
  fi
}

wait_for_db() {
  printf "${YELLOW}Waiting for database to be ready …${RESET}\n"
  local retries=30
  while [[ $retries -gt 0 ]]; do
    if ${COMPOSE_CMD} exec -T postgres pg_isready -U forgeos -d forgeos >/dev/null 2>&1; then
      printf "${GREEN}  ✔ Database is ready${RESET}\n"
      return 0
    fi
    retries=$((retries - 1))
    sleep 1
  done
  printf "${RED}✘ Database did not become ready in time${RESET}\n"
  exit 1
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
MODE="${1:-docker}"

printf "${GREEN}ForgeOS — Seeding Database${RESET}\n\n"

case "$MODE" in
  --local)
    # Run seed script directly on the host (needs DATABASE_URL in env)
    printf "Running seed locally …\n"
    cd "${REPO_ROOT}/forgeos-server"
    npx tsx src/db/seed.ts
    ;;

  *)
    # Run seed inside the MCP server container
    check_services
    wait_for_db

    printf "Running seed via container …\n"
    ${COMPOSE_CMD} exec -T mcp-server npx tsx src/db/seed.ts
    ;;
esac

# ---------------------------------------------------------------------------
# Optional: Import ticket JSON files
# ---------------------------------------------------------------------------
IMPORT_SCRIPT="${REPO_ROOT}/forgeos-server/scripts/import-tickets.ts"
TICKETS_DIR="${REPO_ROOT}/.github/tickets"

if [[ -f "$IMPORT_SCRIPT" && -d "$TICKETS_DIR" ]]; then
  TICKET_COUNT=$(find "$TICKETS_DIR" -name '*.json' | wc -l)
  if [[ "$TICKET_COUNT" -gt 0 ]]; then
    printf "\n${YELLOW}Importing ${TICKET_COUNT} ticket files …${RESET}\n"
    case "$MODE" in
      --local)
        cd "${REPO_ROOT}/forgeos-server"
        npx tsx scripts/import-tickets.ts "$TICKETS_DIR" 2>/dev/null || \
          printf "${YELLOW}  ⚠  Ticket import skipped (script may require running services)${RESET}\n"
        ;;
      *)
        ${COMPOSE_CMD} exec -T mcp-server npx tsx scripts/import-tickets.ts /workspace/.github/tickets 2>/dev/null || \
          printf "${YELLOW}  ⚠  Ticket import skipped (script may require DB tables)${RESET}\n"
        ;;
    esac
  fi
fi

printf "\n${GREEN}✔ Seed complete.${RESET}\n"
