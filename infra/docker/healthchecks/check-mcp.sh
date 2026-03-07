#!/bin/sh
# =============================================================================
# ForgeOS — MCP Server Health Check Script
# =============================================================================
# Verifies that the ForgeOS MCP server is:
#   1. Responding on the /health endpoint with HTTP 200
#   2. Returning valid JSON with status "ok"
#
# Used by Docker Compose HEALTHCHECK and Kubernetes liveness/readiness probes.
#
# Exit codes:
#   0 = healthy (endpoint returns 200 with status ok)
#   1 = unhealthy (endpoint unreachable, non-200, or status not ok)
#
# Environment variables (overridable):
#   MCP_HOST    — Hostname or IP (default: localhost)
#   MCP_PORT    — Port (default: 3000)
#   TIMEOUT     — Request timeout in seconds (default: 5)
#
# Ticket:  FORGEOS-DO008
# Author:  DevOps Engineer
# Date:    2026-03-07
# =============================================================================

set -e

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
MCP_HOST="${MCP_HOST:-localhost}"
MCP_PORT="${MCP_PORT:-3000}"
TIMEOUT="${TIMEOUT:-5}"

HEALTH_URL="http://${MCP_HOST}:${MCP_PORT}/health"

# ---------------------------------------------------------------------------
# Check 1: HTTP GET /health — Does the endpoint respond with 200?
# ---------------------------------------------------------------------------
HTTP_CODE=$(curl -sf -o /dev/null -w "%{http_code}" \
    --max-time "$TIMEOUT" \
    "$HEALTH_URL" 2>/dev/null) || {
    echo "UNHEALTHY: MCP server at ${HEALTH_URL} is not responding"
    exit 1
}

if [ "$HTTP_CODE" -ne 200 ]; then
    echo "UNHEALTHY: MCP server returned HTTP ${HTTP_CODE} (expected 200)"
    exit 1
fi

# ---------------------------------------------------------------------------
# Check 2: Response body — Does it contain status "ok"?
# ---------------------------------------------------------------------------
RESPONSE=$(curl -sf --max-time "$TIMEOUT" "$HEALTH_URL" 2>/dev/null) || {
    echo "UNHEALTHY: MCP server health response could not be read"
    exit 1
}

# Use grep to check for "ok" status in JSON response
echo "$RESPONSE" | grep -q '"status"[[:space:]]*:[[:space:]]*"ok"' || {
    echo "UNHEALTHY: MCP server health status is not 'ok': ${RESPONSE}"
    exit 1
}

echo "HEALTHY: MCP server is responding with status ok"
exit 0
