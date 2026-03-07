#!/usr/bin/env bash
# ──────────────────────────────────────────────────────
# ForgeOS blast radius validation (pre-commit)
#
# Ensures staged files are within the ticket's declared
# file_paths scope. Queries the MCP server REST API to
# retrieve allowed paths, then validates each staged
# file using prefix matching.
#
# Ticket ID resolution (priority order):
#   1. FORGEOS_TICKET_ID environment variable
#   2. Last commit message [TICKET-ID] pattern
#
# Graceful degradation:
#   - MCP server unreachable → WARNING, allow commit
#   - No ticket context → INFO, allow commit
#
# Bypass: git commit --no-verify
# ──────────────────────────────────────────────────────

set -euo pipefail

# ─── Configuration ────────────────────────────────────

# MCP server base URL (override via env)
MCP_URL="${FORGEOS_MCP_URL:-http://localhost:3000}"

# Timeout for API requests (seconds)
CURL_TIMEOUT="${FORGEOS_CURL_TIMEOUT:-5}"

# ─── Helpers ──────────────────────────────────────────

info()    { echo "[INFO]    $*"; }
warn()    { echo "[WARNING] $*"; }
error()   { echo "[ERROR]   $*"; }

# ─── Step 1: Resolve Ticket ID ───────────────────────

resolve_ticket_id() {
  # Priority 1: Environment variable
  if [[ -n "${FORGEOS_TICKET_ID:-}" ]]; then
    echo "${FORGEOS_TICKET_ID}"
    return 0
  fi

  # Priority 2: Last commit message pattern [TICKET-ID]
  local last_msg
  last_msg="$(git log -1 --format='%s' 2>/dev/null || true)"

  if [[ -n "${last_msg}" ]]; then
    local ticket_id
    ticket_id="$(echo "${last_msg}" | grep -oP '^\[([A-Z0-9]+-[A-Z0-9]+(-[A-Z0-9]+)*)\]' | tr -d '[]' || true)"
    if [[ -n "${ticket_id}" ]]; then
      echo "${ticket_id}"
      return 0
    fi
  fi

  return 1
}

# ─── Step 2: Query MCP Server for file_paths ─────────

query_ticket_paths() {
  local ticket_id="$1"
  local api_url="${MCP_URL}/api/tickets/${ticket_id}"
  local response

  # Attempt to fetch ticket data; fail gracefully
  if ! response="$(curl -sf --max-time "${CURL_TIMEOUT}" "${api_url}" 2>/dev/null)"; then
    return 1
  fi

  # Extract file_paths array as newline-separated list
  # Uses python3 for reliable JSON parsing (available on all targets)
  echo "${response}" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    paths = data.get('file_paths', [])
    for p in paths:
        print(p)
except (json.JSONDecodeError, KeyError):
    sys.exit(1)
" 2>/dev/null

  return $?
}

# ─── Step 3: Validate staged files ───────────────────

validate_scope() {
  local ticket_id="$1"
  shift
  local -a allowed_paths=("$@")
  local -a violations=()

  # Get staged files
  local -a staged_files
  mapfile -t staged_files < <(git diff --cached --name-only 2>/dev/null)

  if [[ ${#staged_files[@]} -eq 0 ]]; then
    info "No staged files to validate."
    return 0
  fi

  # Check each staged file against allowed paths (prefix matching)
  for file in "${staged_files[@]}"; do
    local matched=false
    for allowed in "${allowed_paths[@]}"; do
      # Prefix match: file starts with allowed path
      if [[ "${file}" == "${allowed}" || "${file}" == "${allowed}/"* ]]; then
        matched=true
        break
      fi
    done
    if [[ "${matched}" == "false" ]]; then
      violations+=("${file}")
    fi
  done

  if [[ ${#violations[@]} -gt 0 ]]; then
    echo ""
    echo "═══════════════════════════════════════════════════"
    echo " COMMIT REJECTED — Blast Radius Violation"
    echo "═══════════════════════════════════════════════════"
    echo ""
    echo " Ticket: ${ticket_id}"
    echo ""
    echo " Out-of-scope files:"
    for v in "${violations[@]}"; do
      echo "   ✗ ${v}"
    done
    echo ""
    echo " Allowed paths for this ticket:"
    for a in "${allowed_paths[@]}"; do
      echo "   ✓ ${a}"
    done
    echo ""
    echo " Options:"
    echo "   1. Remove out-of-scope files: git reset HEAD <file>"
    echo "   2. Emergency bypass: git commit --no-verify"
    echo "   3. Update ticket scope if paths are correct"
    echo ""
    echo "═══════════════════════════════════════════════════"
    return 1
  fi

  return 0
}

# ─── Main ─────────────────────────────────────────────

main() {
  # Resolve ticket ID
  local ticket_id
  if ! ticket_id="$(resolve_ticket_id)"; then
    info "No ticket context available (no FORGEOS_TICKET_ID env var and no ticket ID in last commit)."
    info "Allowing commit without scope validation."
    exit 0
  fi

  info "Ticket: ${ticket_id}"

  # Query MCP server for allowed file paths
  local -a allowed_paths
  if ! mapfile -t allowed_paths < <(query_ticket_paths "${ticket_id}"); then
    warn "MCP server unreachable at ${MCP_URL} — skipping scope validation."
    warn "Allowing commit without blast radius check."
    exit 0
  fi

  # Filter out empty lines
  local -a filtered_paths=()
  for p in "${allowed_paths[@]}"; do
    [[ -n "${p}" ]] && filtered_paths+=("${p}")
  done

  if [[ ${#filtered_paths[@]} -eq 0 ]]; then
    warn "MCP server returned no file_paths for ticket ${ticket_id}."
    warn "Allowing commit without scope validation."
    exit 0
  fi

  info "Allowed paths: ${filtered_paths[*]}"

  # Validate staged files against allowed paths
  if ! validate_scope "${ticket_id}" "${filtered_paths[@]}"; then
    exit 1
  fi

  info "All staged files are within ticket scope. ✓"
  exit 0
}

main "$@"
