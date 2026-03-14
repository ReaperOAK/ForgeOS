# MCP-Only Cutover Guide

> **Type:** How-To (Diátaxis)  
> **Audience:** ForgeOS operators and administrators  
> **Last Reviewed:** 2026-03-12  
> **Phase:** 1 — The Cutover (complete)

---

## Table of Contents

| # | Section |
|---|---------|
| 1 | [Purpose](#1-purpose) |
| 2 | [Prerequisites](#2-prerequisites) |
| 3 | [Migration Procedure](#3-migration-procedure) |
| 4 | [New MCP Tools](#4-new-mcp-tools) |
| 5 | [Orchestrator Configuration](#5-orchestrator-configuration) |
| 6 | [Agent SDK Changes](#6-agent-sdk-changes) |
| 7 | [Verification Checklist](#7-verification-checklist) |
| 8 | [Rollback Procedure](#8-rollback-procedure) |
| 9 | [Troubleshooting](#9-troubleshooting) |

---

## 1. Purpose

Phase 1 replaces the filesystem-based ticket state machine with
PostgreSQL as the sole source of truth. After cutover:

- Ticket state lives in the `tickets` table, not in `.github/ticket-state/` directories.
- Agents read tickets via MCP tools (`tickets.get`, `tickets.list`, `tickets.payload`), not JSON files.
- The ForgeOS orchestrator polls the database for READY tickets instead of scanning directories.
- Git commits carry code artifacts only — no ticket JSON state changes.

---

## 2. Prerequisites

| Requirement | How to verify |
|-------------|---------------|
| PostgreSQL 14+ running | `psql -c "SELECT version();"` |
| Migration 001 applied | `SELECT * FROM schema_migrations WHERE version = '001';` |
| ForgeOS MCP server built | `cd forgeos-server && npm run build` |
| Docker Compose available | `docker compose version` |
| Node.js 18+ with tsx | `npx tsx --version` |
| `.env` configured | See [Section 5](#5-orchestrator-configuration) |

Ensure the following environment variables are set in `forgeos-server/.env`:

```env
DATABASE_URL=postgresql://forgeos:password@localhost:5432/forgeos
PORT=3011
NODE_ENV=development
ADMIN_API_KEY=<your-admin-key>
DEFAULT_LEASE_MINUTES=30
MAX_LEASE_MINUTES=120
```

---

## 3. Migration Procedure

### Step 1 — Stop all agents

Ensure no agents are running and no tickets are in-flight.

```bash
# Check for active claims
curl -s http://localhost:3011/api/tickets?status=CLAIMED \
  -H "Authorization: Bearer $ADMIN_API_KEY" | jq '.total_count'
```

If the count is not zero, wait for active work to complete or release
stale claims:

```bash
curl -X POST http://localhost:3011/api/admin/release-expired \
  -H "Authorization: Bearer $ADMIN_API_KEY"
```

### Step 2 — Back up filesystem state

```bash
cp -r .github/tickets/ .github/tickets.bak/
cp -r .github/ticket-state/ .github/ticket-state.bak/
```

### Step 3 — Run database migrations

```bash
cd forgeos-server
npx tsx scripts/run-migrations.ts
```

### Step 4 — Run the filesystem migration script

**Dry run first** to preview what will be migrated:

```bash
npx tsx scripts/migrate-filesystem.ts --dry-run /path/to/workspace
```

Review the output. Then execute the real migration:

```bash
npx tsx scripts/migrate-filesystem.ts /path/to/workspace
```

The script:
- Scans `.github/tickets/*.json` for ticket definitions.
- Determines current stage from `.github/ticket-state/` directories.
- Inserts ticket records and reconstructed event history into PostgreSQL.
- Is idempotent — re-running skips existing tickets.
- Reports statistics: total, migrated, skipped, errors.

Expected output:

```
Migration complete:
  Total:    142
  Migrated: 142
  Skipped:  0
  Errors:   0
```

### Step 5 — Verify migration

```bash
# Count tickets in the database
psql -c "SELECT stage, COUNT(*) FROM tickets GROUP BY stage ORDER BY stage;"

# Verify a specific ticket
curl -s http://localhost:3011/mcp \
  -H "Content-Type: application/json" \
  -d '{"method":"tickets.get","params":{"ticket_id":"TASK-INT-BE011"}}' \
  | jq '.result.ticket.title'
```

### Step 6 — Start the MCP server

```bash
cd forgeos-server
npm start
```

The orchestrator begins polling for READY tickets automatically.

### Step 7 — Validate agent boot sequence

Launch a test agent to verify MCP connectivity:

```python
from forgeos_sdk import ForgeOSClient, TicketOperations

async with ForgeOSClient("http://localhost:3011/mcp") as client:
    ops = TicketOperations(client)
    tickets = await ops.tickets_list(stage="READY", limit=5)
    print(f"Found {tickets.total} READY tickets")
```

---

## 4. New MCP Tools

Three read-access tools were added to support the cutover.

### 4.1 tickets.get

Retrieves full ticket details by ID, including event history.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `ticket_id` | `string` | Yes | Human-readable ticket ID (e.g. `TASK-INT-BE011`) |

**Response:**

```json
{
  "ticket": {
    "ticket_id": "TASK-INT-BE011",
    "title": "Implement tickets.get MCP tool",
    "type": "backend",
    "priority": "high",
    "status": "READY",
    "stage": "BACKEND",
    "claimed_by": null,
    "file_paths": ["forgeos-server/src/tools/tickets-get.ts"],
    "acceptance_criteria": ["..."],
    "depends_on": [],
    "rework_count": 0,
    "history": [
      {
        "event_type": "CREATED",
        "agent_name": "migration",
        "created_at": "2026-03-10T00:00:00Z"
      }
    ]
  },
  "message": "Ticket retrieved successfully"
}
```

**Error codes:**
- `NOT_FOUND` — ticket does not exist.

**Source:** `forgeos-server/src/tools/tickets-get.ts`

### 4.2 tickets.list

Returns a paginated list of ticket summaries with optional filters.

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `stage` | `string` | No | — | Filter by SDLC stage |
| `status` | `string` | No | — | Filter by status (`READY`, `CLAIMED`, `DONE`, etc.) |
| `type` | `string` | No | — | Filter by ticket type (`backend`, `frontend`, etc.) |
| `priority` | `string` | No | — | Filter by priority (`critical`, `high`, `medium`, `low`) |
| `tags` | `string[]` | No | — | Filter by tags (tickets must match ALL tags) |
| `sort_by` | `string` | No | `created_at` | Sort field: `priority`, `created_at`, `updated_at` |
| `sort_order` | `string` | No | `desc` | Sort direction: `asc`, `desc` |
| `limit` | `number` | No | `50` | Results per page (1–200) |
| `offset` | `number` | No | `0` | Pagination offset |

**Response:**

```json
{
  "tickets": [
    {
      "ticket_id": "TASK-INT-BE011",
      "title": "Implement tickets.get MCP tool",
      "type": "backend",
      "priority": "high",
      "status": "READY",
      "stage": "BACKEND",
      "claimed_by_name": null,
      "tags": ["phase-1", "mcp"],
      "rework_count": 0,
      "created_at": "2026-03-10T00:00:00Z",
      "updated_at": "2026-03-10T00:00:00Z"
    }
  ],
  "total_count": 142,
  "limit": 50,
  "offset": 0
}
```

**Source:** `forgeos-server/src/tools/tickets-list.ts`

### 4.3 tickets.payload

Returns the full delegation context an agent needs to begin work.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `ticket_id` | `string` | Yes | Ticket ID to retrieve context for |
| `agent_role` | `string` | Yes | SDLC stage or role of the requesting agent (e.g. `BACKEND`) |

**Response:**

```json
{
  "ticket": { "...full ticket object..." },
  "upstream_summary": "# Previous Stage Summary\n\n...",
  "file_scope": ["forgeos-server/src/tools/tickets-get.ts"],
  "memory_entries": [
    {
      "event_type": "STAGE_ADVANCED",
      "agent_name": "Architect",
      "payload": { "notes": "..." },
      "created_at": "2026-03-10T00:00:00Z"
    }
  ],
  "message": "Delegation payload assembled"
}
```

The handler:
1. Fetches the ticket from PostgreSQL.
2. Determines the upstream stage from the ticket's `sdlc_flow` array.
3. Reads the upstream summary file from `.github/agent-output/{Agent}/{ticket-id}.md`.
4. Queries the `events` table for memory entries.
5. Returns combined payload.

**Source:** `forgeos-server/src/tools/tickets-payload.ts`

---

## 5. Orchestrator Configuration

The ForgeOS orchestrator is a persistent polling loop that replaces the
stateless ForgeOS dispatcher.

**Source:** `forgeos-server/src/services/orchestrator.ts`

### 5.1 Environment Variables

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `DATABASE_URL` | `string` | — | PostgreSQL connection string (required) |
| `PORT` | `number` | `3011` | HTTP server port |
| `NODE_ENV` | `string` | `development` | Environment (`development`, `production`, `test`) |
| `LOG_LEVEL` | `string` | `info` | Log level (`trace`, `debug`, `info`, `warn`, `error`) |
| `ADMIN_API_KEY` | `string` | — | Admin API key (min 8 characters; change default in production) |
| `WEBHOOK_SECRET` | `string` | — | GitHub webhook secret (required in production) |
| `WORKSPACE_PATH` | `string` | — | Repository root path for file operations |
| `DEFAULT_LEASE_MINUTES` | `number` | `30` | Default claim lease duration (5–120 minutes) |
| `MAX_LEASE_MINUTES` | `number` | `120` | Maximum allowed lease duration (10–480 minutes) |
| `RATE_LIMIT_PER_MINUTE` | `number` | `100` | API rate limit per client per minute |
| `RECONCILIATION_INTERVAL` | `number` | `300` | Seconds between reconciliation sweeps |

### 5.2 Orchestrator Parameters

Set in code via `createOrchestrator()`:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `pollIntervalMs` | `10000` | Milliseconds between poll cycles |
| `machineName` | `'unknown'` | Hostname for claim metadata |
| `operatorName` | `'system'` | Operator name for claim metadata |
| `leaseMinutes` | `30` | Lease duration for claimed tickets |

```typescript
import { createOrchestrator } from './services/orchestrator.js';

const orchestrator = createOrchestrator(pool, {
  pollIntervalMs: 10_000,
  machineName: os.hostname(),
  operatorName: 'production',
  leaseMinutes: 30,
});

await orchestrator.start();
```

### 5.3 Stage-to-Agent Mapping

The orchestrator maps each SDLC stage to an agent name:

| Stage | Agent |
|-------|-------|
| `RESEARCH` | Research |
| `PRODUCT_MANAGER` | ProductManager |
| `ARCHITECT` | Architect |
| `BACKEND` | Backend |
| `FRONTEND` | Frontend |
| `UI_DESIGN` | UIDesigner |
| `QA` | QA |
| `SECURITY` | Security |
| `CI` | CIReviewer |
| `DOCUMENTATION` | Documentation |
| `VALIDATOR` | Validator |

Unmapped stages (`READY`, `DONE`) are system-managed and skipped by the
dispatch loop.

### 5.4 Polling Behavior

Each poll cycle:

1. Queries `tickets` for rows with `status = 'READY'` and no active claim
   (or expired lease), ordered by priority then creation time.
2. For each ticket, resolves the agent name from the stage mapping.
3. Calls `claim_ticket_by_id()` stored function (uses `SELECT FOR UPDATE
   SKIP LOCKED` for concurrency).
4. Records a `CLAIMED` event in the `events` table.
5. Auto-registers unknown agents on first dispatch.

Multiple orchestrator instances can run simultaneously — the database
ensures exactly one instance wins each claim.

---

## 6. Agent SDK Changes

The Python agent SDK (`agent-sdk/src/forgeos_sdk/`) gained three new
methods on `TicketOperations`:

### 6.1 tickets_get

```python
async def tickets_get(self, ticket_id: str) -> Ticket
```

Calls `tickets.get` MCP tool. Returns a `Ticket` with full detail.

```python
from forgeos_sdk import ForgeOSClient, TicketOperations

async with ForgeOSClient("http://localhost:3011/mcp") as client:
    ops = TicketOperations(client)
    ticket = await ops.tickets_get("TASK-INT-BE011")
    print(ticket.title, ticket.stage, ticket.status)
```

### 6.2 tickets_list

```python
async def tickets_list(
    self,
    *,
    stage: str | None = None,
    status: str | None = None,
    type: str | None = None,
    priority: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> ListResponse
```

Calls `tickets.list` MCP tool. Returns a `ListResponse` with `tickets`,
`total`, `limit`, and `offset`.

```python
result = await ops.tickets_list(stage="READY", priority="high", limit=10)
for ticket in result.tickets:
    print(f"  {ticket.ticket_id}: {ticket.title}")
print(f"Total: {result.total}")
```

### 6.3 tickets_payload

```python
async def tickets_payload(
    self,
    ticket_id: str,
    agent_role: str,
) -> DelegationPayload
```

Calls `tickets.payload` MCP tool. Returns a `DelegationPayload` with:
- `ticket` — full ticket object
- `upstream_summary` — markdown from the previous stage agent
- `memory_entries` — relevant events for context
- `file_scope` — authorized file paths

```python
payload = await ops.tickets_payload("TASK-INT-BE011", "BACKEND")
print(f"Upstream: {payload.upstream_summary[:100]}...")
print(f"Files: {payload.file_scope}")
```

### 6.4 New Models

| Model | Module | Purpose |
|-------|--------|---------|
| `ListResponse` | `forgeos_sdk.models` | Paginated ticket list with `tickets`, `total`, `limit`, `offset` |
| `DelegationPayload` | `forgeos_sdk.models` | Full context packet: ticket + upstream summary + memory + file scope |

---

## 7. Verification Checklist

Run through this list after migration to confirm successful cutover.

| # | Check | Command |
|---|-------|---------|
| 1 | Ticket count matches | `psql -c "SELECT COUNT(*) FROM tickets;"` vs `.github/tickets/*.json` count |
| 2 | Stage distribution matches | `psql -c "SELECT stage, COUNT(*) FROM tickets GROUP BY stage;"` |
| 3 | Event history present | `psql -c "SELECT COUNT(*) FROM events;"` (should be > 0) |
| 4 | MCP server responds | `curl http://localhost:3011/health` |
| 5 | tickets.get works | Call via MCP and verify ticket data |
| 6 | tickets.list works | Call with `stage=READY` filter |
| 7 | tickets.payload works | Call with a known ticket ID |
| 8 | Orchestrator polling | Check server logs for `Orchestrator started` |
| 9 | Agent SDK connects | Run the Python snippet from Section 6.1 |
| 10 | No filesystem reads in boot | Verify agent instruction files reference MCP tools, not `.github/ticket-state/` |

---

## 8. Rollback Procedure

If the cutover causes issues, revert to the filesystem-based workflow.

### Step 1 — Stop the MCP server and orchestrator

```bash
docker compose -f forgeos-server/docker-compose.yml down
```

### Step 2 — Restore filesystem state

```bash
rm -rf .github/tickets/
cp -r .github/tickets.bak/ .github/tickets/

rm -rf .github/ticket-state/
cp -r .github/ticket-state.bak/ .github/ticket-state/
```

### Step 3 — Revert instruction files

```bash
git checkout HEAD~1 -- .github/instructions/ .github/agents/ agents.md
```

This restores the pre-cutover instruction and agent files that reference
filesystem paths.

### Step 4 — Verify filesystem state

```bash
ls .github/ticket-state/READY/ | wc -l
python3 .github/tickets.py --status
```

### Step 5 — Resume filesystem-based workflow

Agents will resume reading ticket JSON from `.github/tickets/` and
scanning `.github/ticket-state/` directories.

### Cleanup after stable cutover

Once the MCP-based workflow is confirmed stable (recommended: 48 hours
of production use), remove the backup directories:

```bash
rm -rf .github/tickets.bak/ .github/ticket-state.bak/
```

---

## 9. Troubleshooting

### Migration script fails with connection error

Verify `DATABASE_URL` in `.env`. Confirm PostgreSQL is running:

```bash
pg_isready -h localhost -p 5432
```

### Agent cannot connect to MCP server

Check the server is running and accessible:

```bash
curl -s http://localhost:3011/health | jq .
```

Verify the agent's MCP URL configuration matches the server address.

### Orchestrator finds no READY tickets

Check ticket status in the database:

```bash
psql -c "SELECT status, COUNT(*) FROM tickets GROUP BY status;"
```

If tickets show `CLAIMED` with expired leases, release them:

```bash
curl -X POST http://localhost:3011/api/admin/release-expired \
  -H "Authorization: Bearer $ADMIN_API_KEY"
```

### Duplicate ticket errors during migration

The migration script is idempotent. Duplicates are skipped. If errors
persist, check for ticket ID collisions:

```bash
psql -c "SELECT ticket_id, COUNT(*) FROM tickets GROUP BY ticket_id HAVING COUNT(*) > 1;"
```

### Agent sees stale upstream summary

The `tickets.payload` tool reads upstream summaries from
`.github/agent-output/{Agent}/{ticket-id}.md`. Ensure the previous stage
agent wrote its summary file before advancing.
