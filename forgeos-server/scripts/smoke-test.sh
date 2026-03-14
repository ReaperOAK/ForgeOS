#!/usr/bin/env bash
# ForgeOS MCP Server — Integration Smoke Test
#
# Prerequisites:
#   - Docker and Docker Compose installed
#   - curl and jq installed
#   - Run from the repository root
#
# Usage:
#   bash forgeos-server/scripts/smoke-test.sh
#
# Exit code 0 = all checks pass, non-zero = failure

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

PASS=0
FAIL=0
BASE_URL="http://localhost:3011"

pass() { echo -e "${GREEN}✓ $1${NC}"; ((PASS++)); }
fail() { echo -e "${RED}✗ $1${NC}"; ((FAIL++)); }

# ── Step 1: Start Docker services ─────────────────────────────────
echo "Step 1: Starting Docker services..."
cd infra
docker compose down -v 2>/dev/null || true
docker compose up -d --build

# ── Step 2: Wait for health check ─────────────────────────────────
echo "Step 2: Waiting for services to become healthy..."
TIMEOUT=90
ELAPSED=0
until curl -sf "$BASE_URL/health" > /dev/null 2>&1; do
  sleep 2
  ELAPSED=$((ELAPSED + 2))
  if [ $ELAPSED -ge $TIMEOUT ]; then
    fail "Health check did not pass within ${TIMEOUT}s"
    docker compose logs mcp-server
    exit 1
  fi
done
pass "Health check passed (${ELAPSED}s)"

# ── Step 3: Verify health response ────────────────────────────────
echo "Step 3: Verifying health response..."
HEALTH=$(curl -sf "$BASE_URL/health")
if echo "$HEALTH" | jq -e '.status == "ok"' > /dev/null 2>&1; then
  pass "Health endpoint returns ok"
else
  fail "Health endpoint returned: $HEALTH"
fi

# ── Step 4: Get admin API key ─────────────────────────────────────
echo "Step 4: Using admin API key..."
ADMIN_KEY="${ADMIN_API_KEY:-forgeos_admin_CHANGE_ME}"
AUTH_HEADER="Authorization: Bearer $ADMIN_KEY"
ACCEPT_HEADER="Accept: application/json, text/event-stream"

# ── Step 5: MCP Initialize ───────────────────────────────────────
echo "Step 5: Testing MCP initialize..."
MCP_INIT=$(curl -sf -X POST "$BASE_URL/mcp" \
  -H "Content-Type: application/json" \
  -H "$ACCEPT_HEADER" \
  -H "$AUTH_HEADER" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": { "name": "smoke-test", "version": "1.0.0" }
    }
  }')

if echo "$MCP_INIT" | grep '^data:' | sed 's/^data: //' | jq -e '.result.serverInfo.name == "forgeos"' > /dev/null 2>&1; then
  pass "MCP initialize succeeded"
else
  fail "MCP initialize failed: $MCP_INIT"
fi

# ── Step 6: List tools ────────────────────────────────────────────
echo "Step 6: Listing MCP tools..."
MCP_TOOLS=$(curl -sf -X POST "$BASE_URL/mcp" \
  -H "Content-Type: application/json" \
  -H "$ACCEPT_HEADER" \
  -H "$AUTH_HEADER" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list",
    "params": {}
  }')
TOOL_COUNT=$(echo "$MCP_TOOLS" | grep '^data:' | sed 's/^data: //' | jq '.result.tools | length')
if [ "$TOOL_COUNT" -eq 21 ]; then
  pass "All 21 tools registered"
else
  fail "Expected 21 tools, got $TOOL_COUNT"
  echo "$MCP_TOOLS" | grep '^data:' | sed 's/^data: //' | jq '.result.tools[].name'
fi

# ── Step 7: Seed demo data ─────────────────────────────────────
echo "Step 7: Seeding demo ticket..."
docker exec forgeos-postgres psql -U forgeos -d forgeos -c "
  INSERT INTO tickets (ticket_id, project_id, title, type, priority, status, stage, sdlc_flow)
  SELECT 'SMOKE-001', p.id, 'Smoke Test Ticket', 'backend', 'medium', 'READY', 'BACKEND',
    ARRAY['BACKEND','QA','SECURITY','CI','DOCUMENTATION','VALIDATOR','DONE']::ticket_stage[]
  FROM projects p WHERE p.name = 'ForgeOS'
  ON CONFLICT (ticket_id) DO NOTHING;
" 2>/dev/null
pass "Demo ticket seeded"

# ── Step 8: tickets.next ──────────────────────────────────────────
echo "Step 8: Testing tickets.next..."
MCP_NEXT=$(curl -sf -X POST "$BASE_URL/mcp" \
  -H "Content-Type: application/json" \
  -H "$ACCEPT_HEADER" \
  -H "$AUTH_HEADER" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "tickets.next",
      "arguments": { "stage": "BACKEND" }
    }
  }')

if echo "$MCP_NEXT" | grep '^data:' | sed 's/^data: //' | jq -e -r '.result.content[0].text' | grep -q "SMOKE-001" 2>/dev/null; then
  pass "tickets.next found SMOKE-001"
else
  fail "tickets.next did not find SMOKE-001: $MCP_NEXT"
fi

# ── Step 9: REST API ─────────────────────────────────────────────
echo "Step 9: Testing REST API..."
API_TICKETS=$(curl -sf "$BASE_URL/api/tickets" -H "$AUTH_HEADER")
if echo "$API_TICKETS" | jq -e '.data | type == "array"' > /dev/null 2>&1; then
  pass "REST /api/tickets returns paginated data"
else
  fail "REST /api/tickets failed: $API_TICKETS"
fi

API_STAGES=$(curl -sf "$BASE_URL/api/stages" -H "$AUTH_HEADER")
if echo "$API_STAGES" | jq -e 'type' > /dev/null 2>&1; then
  pass "REST /api/stages returns data"
else
  fail "REST /api/stages failed: $API_STAGES"
fi

# ── Step 10: Dashboard ────────────────────────────────────────────
echo "Step 10: Testing dashboard..."
DASH_STATUS=$(curl -sf -o /dev/null -w '%{http_code}' "$BASE_URL/dashboard/")
if [ "$DASH_STATUS" = "200" ]; then
  pass "Dashboard returns 200"
else
  fail "Dashboard returned $DASH_STATUS"
fi

# ── Summary ───────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════"
echo -e "  Results: ${GREEN}${PASS} passed${NC}, ${RED}${FAIL} failed${NC}"
echo "═══════════════════════════════════════"

# Cleanup
cd ..
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
