# ForgeOS MCP Server — Standalone Distribution Architecture

**Author:** Architect Agent  
**Date:** 2026-03-23  
**Status:** PROPOSED  
**Upstream:** [Research Brief](../../.github/agent-output/Research/MCP-DISTRIBUTION-RESEARCH.md)

---

## Table of Contents

1. [Context Map](#1-context-map)
2. [Well-Architected Assessment](#2-well-architected-assessment)
3. [ADRs](#3-architecture-decision-records)
4. [Component Architecture](#4-component-architecture)
5. [Durable Compile Queue Worker](#5-durable-compile-queue-worker)
6. [Multi-Stage Compile Triggers](#6-multi-stage-compile-triggers)
7. [Agent Definition Seeding](#7-agent-definition-seeding)
8. [Graceful Shutdown](#8-graceful-shutdown)
9. [Standalone Docker Distribution](#9-standalone-docker-distribution)
10. [One-Click VS Code Install](#10-one-click-vs-code-install)
11. [File Structure](#11-file-structure)
12. [Database Schema Changes](#12-database-schema-changes)
13. [API Contract Changes](#13-api-contract-changes)
14. [Implementation Sequence](#14-implementation-sequence)
15. [Fitness Functions](#15-fitness-functions)

---

## 1. Context Map

### Primary Files (directly modified)

| File | Change |
|------|--------|
| `forgeos-server/src/index.ts` | Enhanced graceful shutdown, compile worker startup |
| `forgeos-server/src/server.ts` | SSE client tracking for shutdown drain |
| `forgeos-server/src/services/compile-worker.ts` | **NEW** — durable queue worker |
| `forgeos-server/src/services/compile-triggers.ts` | **NEW** — multi-stage trigger hooks |
| `forgeos-server/src/db/seed-agent-definitions.ts` | Add embedding generation, fallback logic |
| `forgeos-server/src/db/seed.ts` | Integrate agent definition seeding into boot |
| `forgeos-server/Dockerfile` | Add MCP registry labels, standalone entrypoint |
| `forgeos-server/docker-compose.standalone.yml` | **NEW** — self-contained distribution stack |
| `forgeos-server/scripts/standalone-entrypoint.sh` | **NEW** — first-run bootstrap |
| `.vscode/mcp.json` | **NEW** — workspace MCP config example |

### Secondary Files (indirectly affected)

| File | Impact |
|------|--------|
| `forgeos-server/src/config.ts` | New config fields for compile worker |
| `forgeos-server/src/db/compile-queue.ts` | Additional query functions for worker |
| `forgeos-server/src/services/compile-orchestrator.ts` | Called by worker |
| `forgeos-server/src/tools/tickets-complete.ts` | Emits compile trigger |
| `forgeos-server/src/middleware/logging.ts` | Worker logging context |
| `forgeos-server/package.json` | Version bump, `bin` field for npx |

### Established Patterns

- Express app factory in `server.ts`, startup in `index.ts`
- Zod-validated config via `config.ts`
- SQL migrations in `src/db/migrations/` with checksum tracking
- Idempotent seeding with `ON CONFLICT DO UPDATE`
- Structured Pino logging throughout
- `pool.query()` for all DB access (no ORM)
- `LISTEN/NOTIFY` for SSE push

### Internal Dependencies

- `@modelcontextprotocol/sdk` — MCP server + transports
- `pg` — PostgreSQL client pool
- `pino` — structured logging
- `zod` — schema validation
- `@google/genai` — Gemini prompt compilation
- `web-tree-sitter` — code indexing

### External Dependencies

- PostgreSQL 17 + pgvector extension
- Ollama (mxbai-embed-large, qwen2.5:7b-instruct)

---

## 2. Well-Architected Assessment

### Operational Excellence — 8/10

| Aspect | Current | Target |
|--------|---------|--------|
| Monitoring | Pino structured logs, `/health` | Add `/ready`, compile queue metrics |
| Debugging | Request IDs, slow-query logging | Worker job IDs in logs |
| Deployment | `docker compose up` | Single `docker compose -f standalone.yml up` |
| Runbooks | Minimal | Standalone troubleshooting guide |

### Security — 7/10

| Aspect | Current | Target |
|--------|---------|--------|
| Auth | API key + SHA-256 hash | Same; auto-generated on first run |
| Secrets | `.env` file, Docker secrets | Docker secrets for standalone |
| Network | CORS configured | Internal-only Ollama/PG in standalone |
| OWASP | Input validation via Zod | No change needed |

### Reliability — 7/10

| Aspect | Current | Target |
|--------|---------|--------|
| Compile queue | In-memory (lost on crash) | Durable PG queue with SKIP LOCKED |
| Shutdown | Basic SIGTERM + 10s force | Ordered drain: SSE → requests → workers → DB |
| Recovery | Lease expiry reconciliation | Dead-letter queue for failed compiles |
| State | PostgreSQL ACID | No change |

### Performance — 8/10

| Aspect | Current | Target |
|--------|---------|--------|
| Latency | <100ms for tool calls | No change |
| Throughput | 100 req/min rate limit | No change |
| Queue | Synchronous compile | Async background worker |
| Connections | Pool max 20 | Worker uses ≤2 dedicated connections |

### Cost Optimization — 9/10

| Aspect | Assessment |
|--------|------------|
| Resource usage | Minimal — Node.js + PG + Ollama |
| Scaling costs | Vertical only (single-node target) |
| Build vs buy | Build (custom prompt compilation) |
| Docker image | Multi-stage, ~150MB runtime |

### Sustainability — 8/10

| Aspect | Assessment |
|--------|------------|
| Maintainability | Clean module boundaries, typed config |
| Team skills | TypeScript standard stack |
| Documentation | JSDoc throughout; architecture docs exist |
| Upgrade path | MCP SDK semver; PG stable |

---

## 3. Architecture Decision Records

### ADR-DIST-001: Docker Compose as Primary Distribution

**Status:** PROPOSED  
**Context:** ForgeOS MCP Server requires PostgreSQL + Ollama as dependencies. The research brief identified three distribution channels: npm/npx, Docker, and remote HTTP. Pure npx cannot bundle PostgreSQL.

**Options Considered:**

| Option | Capability Fit | UX | Complexity | Risk |
|--------|---------------|-----|------------|------|
| npm + external PG | 6/10 | 5/10 — user manages PG | Low | High — PG version mismatch |
| Docker Compose (all-in-one) | 10/10 | 8/10 — one command | Medium | Low |
| Kubernetes Helm | 10/10 | 4/10 — needs k8s | High | Medium |

**Decision:** Docker Compose standalone file as primary. Users run `docker compose -f docker-compose.standalone.yml up` with zero external dependencies.

**Consequences:**
- Users need Docker installed (Docker Desktop or Docker Engine)
- Single-command startup with auto-migration and seeding
- Consistent environment across platforms
- GPU auto-detection passthrough for Ollama

---

### ADR-DIST-002: SKIP LOCKED Worker for Compile Queue

**Status:** PROPOSED  
**Context:** The current `prompt_compile_queue` table (migration 009) exists but has no worker consuming jobs. Compilation happens in-memory, losing work on crash.

**Options Considered:**

| Option | Capability | Reliability | Complexity |
|--------|-----------|-------------|------------|
| In-memory queue (current) | Works | Lost on crash | None |
| PostgreSQL SKIP LOCKED polling | Durable, concurrent-safe | Survives crashes | Low |
| Redis/BullMQ | Durable, sub-second | Adds dependency | High |
| PG LISTEN/NOTIFY push | Durable, event-driven | Needs fallback poll | Medium |

**Decision:** PostgreSQL SKIP LOCKED polling worker. No new dependencies. Leverages existing `prompt_compile_queue` table. Polling interval configurable (default 5s).

**Consequences:**
- Zero new dependencies — uses existing `pg` pool
- Worker polls in a loop with configurable interval
- Each job locked via `FOR UPDATE SKIP LOCKED` — multiple workers safe
- Retry with exponential backoff (attempts stored in table)
- Dead-letter after `max_attempts` (3)
- Compile queue metrics via existing `/api/stats` endpoint

---

### ADR-DIST-003: Event-Driven Compile Triggers

**Status:** PROPOSED  
**Context:** Currently, prompt compilation only triggers when tickets reach READY. Agents at BACKEND, FRONTEND, and TODO stages need pre-compiled prompts.

**Options Considered:**

| Option | Completeness | Complexity | Coupling |
|--------|-------------|------------|---------|
| Manual trigger only | Low | Zero | None |
| PostgreSQL trigger function | Full coverage | Low | DB-level |
| Application-level hook in `tickets-complete.ts` | Full coverage | Low | Code-level |
| LISTEN/NOTIFY event reactor | Full coverage | Medium | Event-level |

**Decision:** PostgreSQL trigger function on `tickets` table. Fires `INSERT INTO prompt_compile_queue` when `stage` changes to a configured set of trigger stages. Declarative, cannot be bypassed by application bugs.

**Consequences:**
- Trigger function defined in new migration `011-compile-triggers.sql`
- Configurable trigger stages stored as array in the trigger function
- Application code does not need modification for new trigger stages
- Worker picks up new jobs automatically via SKIP LOCKED polling

---

### ADR-DIST-004: Database-First Agent Definitions with Filesystem Fallback

**Status:** PROPOSED  
**Context:** Agent definitions in `.github/agents/*.agent.md` must be seeded into `agent_definitions` table for prompt compilation. Standalone distribution won't have `.github/` directory.

**Options Considered:**

| Option | Standalone Support | Fresh Install | Complexity |
|--------|-------------------|---------------|------------|
| Filesystem only (current) | No | Broken | None |
| DB only, seed at build time | Yes | Bundled defaults | Low |
| DB + filesystem fallback | Yes | Works both ways | Medium |
| DB + HTTP fallback to GitHub | Yes | Needs internet | Medium |

**Decision:** Bundle agent definitions as JSON in the Docker image at build time. Seed into DB during migration/boot. The `agent-definition-provider.ts` already reads from DB; add a hardcoded fallback set for cold-start.

**Consequences:**
- `scripts/bundle-agent-defs.mjs` extracts agent `.md` files to `dist/agent-defs.json` at build time
- Boot sequence seeds from bundled JSON if `agent_definitions` table is empty
- Embedding generation runs after seeding (via Ollama)
- Existing `getAgentByStage()` works unchanged
- Filesystem fallback removed from hot path — DB is canonical

---

### ADR-DIST-005: Ordered Graceful Shutdown

**Status:** PROPOSED  
**Context:** Current shutdown closes HTTP server then DB pool with a 10s hard timeout. No explicit draining of SSE, compile workers, or in-flight MCP requests.

**Decision:** Implement a 5-phase shutdown sequence.

**Consequences:**
- Predictable shutdown order prevents resource leaks
- SSE clients receive `{"type":"shutdown"}` before disconnect
- Compile worker finishes current job (up to 30s) then stops
- HTTP server stops accepting new connections, drains in-flight
- DB pool closes last
- 30s total hard timeout (up from 10s)

---

## 4. Component Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Docker Compose Stack                       │
│                                                               │
│  ┌──────────────┐  ┌──────────────────┐  ┌──────────────┐  │
│  │  PostgreSQL   │  │  ForgeOS MCP     │  │   Ollama      │  │
│  │  17 + pgvec   │  │  Server          │  │   (LLM +      │  │
│  │              │◄─┤                  ├──►│   Embedding)  │  │
│  │  :5432       │  │  :3011           │  │  :11434       │  │
│  └──────────────┘  │                  │  └──────────────┘  │
│                     │  ┌────────────┐ │                      │
│                     │  │ Express    │ │                      │
│                     │  │ App        │ │                      │
│                     │  │ /mcp       │ │                      │
│                     │  │ /health    │ │                      │
│                     │  │ /events    │ │                      │
│                     │  │ /dashboard │ │                      │
│                     │  │ /api       │ │                      │
│                     │  └────────────┘ │                      │
│                     │  ┌────────────┐ │                      │
│                     │  │ Compile    │ │                      │
│                     │  │ Worker     │ │                      │
│                     │  │ (SKIP LOCK)│ │                      │
│                     │  └────────────┘ │                      │
│                     │  ┌────────────┐ │                      │
│                     │  │ Reconcile  │ │                      │
│                     │  │ Loop       │ │                      │
│                     │  └────────────┘ │                      │
│                     │  ┌────────────┐ │                      │
│                     │  │ NOTIFY     │ │                      │
│                     │  │ Listener   │ │                      │
│                     │  └────────────┘ │                      │
│                     └──────────────────┘                      │
│                                                               │
│  ┌──────────────┐                                            │
│  │ ollama-init  │  (pulls models on first run, exits)        │
│  └──────────────┘                                            │
└─────────────────────────────────────────────────────────────┘

         ▲ VS Code connects via HTTP
         │
    ┌────┴────┐
    │ VS Code │  .vscode/mcp.json → {"type":"http","url":"http://localhost:3011/mcp"}
    │ + MCP   │
    └─────────┘
```

### Internal Process Architecture

```
index.ts (main)
  │
  ├── 1. runMigrations()
  ├── 2. seed() + seedAgentDefinitions()
  ├── 3. createApp(config) → Express app
  ├── 4. server.listen(PORT)
  ├── 5. startNotifyListener()
  ├── 6. startReconciliationLoop()
  ├── 7. startCompileWorker()          ◄── NEW
  └── 8. registerShutdown(server, worker, reconciler, notifier)  ◄── ENHANCED
```

---

## 5. Durable Compile Queue Worker

### Design

The compile worker is a long-running async loop inside the MCP server process (not a separate container). It polls `prompt_compile_queue` using PostgreSQL `FOR UPDATE SKIP LOCKED` to claim pending jobs.

### Worker Lifecycle

```
startCompileWorker()
  │
  ▼
  ┌─────────────────────────┐
  │ Poll loop (every 5s)    │◄──────────────────────┐
  │                         │                        │
  │ SELECT ... FROM         │                        │
  │ prompt_compile_queue    │                        │
  │ WHERE status='pending'  │                        │
  │   AND next_attempt_at   │                        │
  │       <= NOW()          │                        │
  │ ORDER BY created_at     │                        │
  │ FOR UPDATE SKIP LOCKED  │                        │
  │ LIMIT 1                 │                        │
  └────────┬────────────────┘                        │
           │                                         │
           ▼                                         │
     ┌─ job found? ──┐                               │
     │ No            │ Yes                            │
     │               ▼                                │
     │  UPDATE status='running',                      │
     │         attempts += 1                          │
     │               │                                │
     │               ▼                                │
     │  orchestrateCompilePipeline(ticket_id)         │
     │               │                                │
     │          ┌────┴────┐                           │
     │          │ Success │ Failure                    │
     │          ▼         ▼                            │
     │  status='done'  attempts < max?                │
     │                    │     │                     │
     │               Yes  │     │ No                  │
     │                    ▼     ▼                     │
     │          status='pending'  status='failed'     │
     │          next_attempt_at   (dead letter)       │
     │          += backoff                            │
     │               │                                │
     └───────────────┴────────────────────────────────┘
```

### SQL: Claim Next Job

```sql
-- Atomic claim: locks exactly one pending job, skips locked rows
UPDATE prompt_compile_queue
SET status = 'running',
    attempts = attempts + 1,
    updated_at = NOW()
WHERE id = (
  SELECT id FROM prompt_compile_queue
  WHERE status = 'pending'
    AND next_attempt_at <= NOW()
  ORDER BY created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
RETURNING *;
```

### Retry with Exponential Backoff

```sql
-- On failure: schedule retry with backoff
UPDATE prompt_compile_queue
SET status = 'pending',
    next_attempt_at = NOW() + (INTERVAL '1 second' * POWER(2, attempts)),
    last_error = $2,
    updated_at = NOW()
WHERE id = $1;
```

### Dead Letter

```sql
-- Max attempts exceeded: mark as failed
UPDATE prompt_compile_queue
SET status = 'failed',
    last_error = $2,
    updated_at = NOW()
WHERE id = $1;
```

### Config Additions

```typescript
// Added to configSchema in config.ts
COMPILE_WORKER_POLL_MS: z.coerce.number().int().min(1000).default(5000),
COMPILE_WORKER_ENABLED: z.enum(['true', 'false']).default('true'),
```

### File: `forgeos-server/src/services/compile-worker.ts`

```typescript
interface CompileWorker {
  start(): void;
  stop(): Promise<void>;
  isRunning(): boolean;
}
```

Key behaviors:
- Polls every `COMPILE_WORKER_POLL_MS` (default 5000ms)
- Processes one job per poll cycle (prevents starvation)
- Uses a separate pool connection for the `FOR UPDATE SKIP LOCKED` query
- Logs job ID, ticket ID, duration, success/failure via structured Pino
- Emits `compile_job_started`, `compile_job_completed`, `compile_job_failed` events
- Respects `AbortSignal` for graceful shutdown
- Calls `orchestrateCompilePipeline(ticketId)` from existing service

---

## 6. Multi-Stage Compile Triggers

### Design

A PostgreSQL trigger function fires when a ticket's `stage` column is updated to one of the trigger stages. It inserts a new row into `prompt_compile_queue`.

### Migration: `011-compile-triggers.sql`

```sql
-- 011-compile-triggers.sql
-- Auto-enqueue prompt compilation when tickets reach specific stages.

-- Trigger stages where pre-compilation is valuable
CREATE OR REPLACE FUNCTION trigger_compile_on_stage_change()
RETURNS TRIGGER AS $$
DECLARE
  trigger_stages TEXT[] := ARRAY[
    'READY', 'BACKEND', 'FRONTEND', 'READY'
  ];
  idem_key TEXT;
BEGIN
  -- Only fire on stage changes to trigger stages
  IF NEW.stage = ANY(trigger_stages)
     AND (OLD.stage IS NULL OR OLD.stage != NEW.stage)
  THEN
    idem_key := NEW.ticket_id || ':stage:' || NEW.stage || ':' || NOW()::TEXT;

    INSERT INTO prompt_compile_queue
      (ticket_id, idempotency_key, status, attempts, max_attempts,
       next_attempt_at, created_at, updated_at)
    VALUES
      (NEW.ticket_id, idem_key, 'pending', 0, 3, NOW(), NOW(), NOW())
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach trigger to tickets table
DROP TRIGGER IF EXISTS trg_compile_on_stage_change ON tickets;
CREATE TRIGGER trg_compile_on_stage_change
  AFTER UPDATE OF stage ON tickets
  FOR EACH ROW
  EXECUTE FUNCTION trigger_compile_on_stage_change();
```

### Trigger Stages

| Stage | Reason |
|-------|--------|
| `READY` | Current behavior — compile when dependencies resolve |
| `BACKEND` | Backend agent needs pre-compiled execution prompt |
| `FRONTEND` | Frontend agent needs pre-compiled execution prompt |

Additional stages can be added by modifying the `trigger_stages` array in the trigger function. No application code change needed.

---

## 7. Agent Definition Seeding

### Design

Agent definitions are bundled into the Docker image as a JSON file at build time. On boot, if `agent_definitions` is empty, the bundled definitions are seeded. Embeddings are generated after seeding.

### Build-Time Bundling

**Script:** `forgeos-server/scripts/bundle-agent-defs.mjs`

```
Build Phase:
  .github/agents/*.agent.md
         │
         ▼
  scripts/bundle-agent-defs.mjs
         │
         ▼
  dist/agent-defs.json   (bundled in Docker image)


Boot Phase:
  dist/agent-defs.json
         │
         ▼
  seed-agent-definitions.ts
         │
    ┌────┴────┐
    │ table   │
    │ empty?  │
    │         │
    Yes       No (skip)
    │
    ▼
  INSERT INTO agent_definitions (...)
         │
         ▼
  Generate embeddings via Ollama
         │
         ▼
  INSERT INTO agent_definition_embeddings (...)
```

### Changes to `seed-agent-definitions.ts`

1. **Dual source**: Try filesystem path first (development), fall back to bundled JSON (production/standalone)
2. **Embedding generation**: After inserting definitions, compute 1024-dim embeddings via Ollama and insert into `agent_definition_embeddings`
3. **Idempotent**: Skip if `agent_definitions` count > 0 (unless `--force` flag)

### Fallback Chain

```
1. DB query (primary — always tried first)
   ↓ empty?
2. Bundled JSON at dist/agent-defs.json (standalone mode)
   ↓ not found?
3. Filesystem at .github/agents/*.agent.md (development mode)
   ↓ not found?
4. Return null (caller handles gracefully)
```

---

## 8. Graceful Shutdown

### 5-Phase Shutdown Sequence

```
SIGTERM/SIGINT received
       │
       ▼
Phase 1: Signal Acknowledgment (0s)
  - Log signal received
  - Set isShuttingDown = true
  - Stop accepting new connections (server.close())
       │
       ▼
Phase 2: SSE Drain (≤2s)
  - Send {"type":"shutdown"} to all SSE clients
  - Close all SSE connections
       │
       ▼
Phase 3: Compile Worker Stop (≤30s)
  - Signal worker to stop after current job
  - Wait for in-progress compilation to finish
  - Worker.stop() resolves when idle
       │
       ▼
Phase 4: HTTP Drain (≤10s)
  - Wait for in-flight HTTP requests to complete
  - server.close() callback fires when drained
       │
       ▼
Phase 5: Resource Cleanup (≤2s)
  - Clear reconciliation interval
  - Release NOTIFY listener connection
  - Close database pool (pool.end())
  - Log clean shutdown
  - process.exit(0)
       │
       ▼
Hard Timeout: 30s total
  - If any phase stalls, force process.exit(1)
```

### Implementation in `index.ts`

```typescript
const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, 'Graceful shutdown initiated');

  // Phase 1: Stop accepting connections
  server.close();

  // Phase 2: Drain SSE
  broadcastSSE({ type: 'shutdown' });
  drainSSEClients();

  // Phase 3: Stop compile worker
  await compileWorker.stop();

  // Phase 4: HTTP drain happens in server.close callback
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });

  // Phase 5: Cleanup
  clearInterval(reconciliationTimer);
  await closePool();

  logger.info('Clean shutdown complete');
  process.exit(0);
};

// Hard timeout
const forceTimeout = setTimeout(() => {
  logger.error('Forced shutdown after 30s timeout');
  process.exit(1);
}, 30_000);
forceTimeout.unref();
```

---

## 9. Standalone Docker Distribution

### `forgeos-server/docker-compose.standalone.yml`

Self-contained distribution file that starts the full stack with zero external dependencies.

```yaml
# =========================================================================
# ForgeOS MCP Server — Standalone Distribution
# =========================================================================
# Start:  docker compose -f docker-compose.standalone.yml up -d
# Stop:   docker compose -f docker-compose.standalone.yml down
# Logs:   docker compose -f docker-compose.standalone.yml logs -f mcp-server
# =========================================================================

services:
  postgres:
    image: pgvector/pgvector:pg17
    container_name: forgeos-standalone-pg
    environment:
      POSTGRES_DB: forgeos
      POSTGRES_USER: forgeos
      POSTGRES_PASSWORD: ${FORGEOS_DB_PASSWORD:-forgeos_standalone}
    volumes:
      - forgeos-pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U forgeos -d forgeos"]
      interval: 5s
      timeout: 3s
      retries: 10
      start_period: 10s
    networks:
      - forgeos-internal
    restart: unless-stopped

  ollama:
    image: ollama/ollama:latest
    container_name: forgeos-standalone-ollama
    volumes:
      - forgeos-ollama:/root/.ollama
    networks:
      - forgeos-internal
    healthcheck:
      test: ["CMD-SHELL", "ollama list 2>/dev/null || exit 1"]
      interval: 15s
      timeout: 10s
      start_period: 30s
      retries: 5
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
    restart: unless-stopped

  ollama-init:
    image: ollama/ollama:latest
    container_name: forgeos-standalone-ollama-init
    depends_on:
      ollama:
        condition: service_healthy
    entrypoint: /bin/sh
    command: >
      -c "
        echo 'Pulling embedding model...';
        OLLAMA_HOST=http://ollama:11434 ollama pull mxbai-embed-large;
        echo 'Pulling prompt model...';
        OLLAMA_HOST=http://ollama:11434 ollama pull qwen2.5:7b-instruct;
        echo 'Models ready.'
      "
    networks:
      - forgeos-internal
    restart: "no"

  mcp-server:
    image: ghcr.io/forgeos/mcp-server:latest
    build:
      context: .
      dockerfile: Dockerfile
    container_name: forgeos-mcp
    depends_on:
      postgres:
        condition: service_healthy
      ollama-init:
        condition: service_completed_successfully
    environment:
      DATABASE_URL: "postgresql://forgeos:${FORGEOS_DB_PASSWORD:-forgeos_standalone}@postgres:5432/forgeos"
      PORT: "3011"
      NODE_ENV: production
      LOG_LEVEL: ${FORGEOS_LOG_LEVEL:-info}
      ADMIN_API_KEY: ${FORGEOS_ADMIN_API_KEY:-}
      EMBEDDING_PROVIDER: ollama
      EMBEDDING_MODEL: mxbai-embed-large
      OLLAMA_BASE_URL: "http://ollama:11434/api/embed"
      OLLAMA_GENERATE_URL: "http://ollama:11434/api/generate"
      PROMPT_LLM_PROVIDER: ollama
      PROMPT_LLM_MODEL: qwen2.5:7b-instruct
      COMPILE_WORKER_ENABLED: "true"
      COMPILE_WORKER_POLL_MS: "5000"
    ports:
      - "${FORGEOS_PORT:-3011}:3011"
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3011/health"]
      interval: 15s
      timeout: 5s
      start_period: 20s
      retries: 3
    networks:
      - forgeos-internal
    restart: unless-stopped

networks:
  forgeos-internal:
    driver: bridge

volumes:
  forgeos-pgdata:
    driver: local
  forgeos-ollama:
    driver: local
```

### First-Run Bootstrap

On first run, the MCP server boot sequence in `index.ts` handles:

1. **Migrations** — `runMigrations()` creates all tables
2. **Seeding** — `seed()` creates default project + admin agent
3. **API Key Generation** — If `FORGEOS_ADMIN_API_KEY` env var is empty, `seed()` generates a random key and logs it once:
   ```
   ════════════════════════════════════════════════
   ADMIN API KEY (save this — shown only once):
   fos_a1b2c3d4e5f6...
   ════════════════════════════════════════════════
   ```
4. **Agent Definitions** — Seeded from bundled JSON
5. **Compile Worker** — Starts polling

### Configuration via Environment

Users customize the standalone stack with a `.env` file:

```env
# .env (optional, placed next to docker-compose.standalone.yml)
FORGEOS_PORT=3011
FORGEOS_DB_PASSWORD=my_secure_password
FORGEOS_ADMIN_API_KEY=my_custom_key_at_least_8_chars
FORGEOS_LOG_LEVEL=info
```

### GPU Passthrough for Ollama

The `deploy.resources.reservations` block enables NVIDIA GPU passthrough when available. On CPU-only hosts, Docker silently falls back to CPU inference. The `ollama` container image handles this automatically.

---

## 10. One-Click VS Code Install

### `.vscode/mcp.json` (workspace example)

```json
{
  "servers": {
    "forgeos": {
      "type": "http",
      "url": "http://localhost:${input:forgeos-port}/mcp",
      "headers": {
        "Authorization": "Bearer ${input:forgeos-api-key}"
      }
    }
  },
  "inputs": [
    {
      "id": "forgeos-port",
      "type": "promptString",
      "description": "ForgeOS MCP server port",
      "default": "3011"
    },
    {
      "id": "forgeos-api-key",
      "type": "promptString",
      "description": "ForgeOS admin API key (from first-run output)",
      "password": true
    }
  ]
}
```

### README Badge (URI-encoded)

The one-click install badge for HTTP transport:

```markdown
[![Install ForgeOS MCP in VS Code](https://img.shields.io/badge/VS_Code-Install_ForgeOS_MCP-0078d4?style=flat-square&logo=visual-studio-code&logoColor=white)](vscode:mcp/install?%7B%22name%22%3A%22forgeos%22%2C%22type%22%3A%22http%22%2C%22url%22%3A%22http%3A%2F%2Flocalhost%3A3011%2Fmcp%22%7D)
```

Decoded URI payload:
```json
{"name":"forgeos","type":"http","url":"http://localhost:3011/mcp"}
```

### Environment Configuration Guide

Include in README:

```markdown
## Configure ForgeOS MCP in VS Code

### Option 1: HTTP (recommended after docker compose up)
Add to `.vscode/mcp.json`:
```json
{
  "servers": {
    "forgeos": {
      "type": "http",
      "url": "http://localhost:3011/mcp"
    }
  }
}
```

### Option 2: Authenticated HTTP
```json
{
  "servers": {
    "forgeos": {
      "type": "http",
      "url": "http://localhost:3011/mcp",
      "headers": {
        "Authorization": "Bearer ${input:forgeos-key}"
      }
    }
  }
}
```
```

---

## 11. File Structure

### New Files

```
forgeos-server/
  docker-compose.standalone.yml              # Self-contained distribution
  scripts/
    bundle-agent-defs.mjs                    # Build-time agent def extraction
  src/
    services/
      compile-worker.ts                      # Durable queue worker
      compile-triggers.ts                    # Trigger registration (app-side docs)
    db/
      migrations/
        011-compile-triggers.sql             # PG trigger for multi-stage compile
.vscode/
  mcp.json                                   # Workspace MCP config example
```

### Modified Files

```
forgeos-server/
  src/
    index.ts                                 # Enhanced shutdown, worker startup
    server.ts                                # Export drainSSEClients()
    config.ts                                # COMPILE_WORKER_* fields
    db/
      seed.ts                                # Integrate agent def seeding
      seed-agent-definitions.ts              # Bundled JSON support, embeddings
      compile-queue.ts                       # claimNextJob(), markDone(), markFailed()
  Dockerfile                                 # MCP registry labels
  package.json                               # bin field, version bump
```

---

## 12. Database Schema Changes

### Migration 011: Compile Triggers

New trigger function on `tickets` table — no new tables. See [Section 6](#6-multi-stage-compile-triggers).

### No Other Schema Changes

- `prompt_compile_queue` (migration 009) — already exists, used as-is
- `agent_definitions` (migration 010) — already exists, used as-is
- `agent_definition_embeddings` (migration 010) — already exists, used as-is

---

## 13. API Contract Changes

### New Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/ready` | Readiness probe (DB + Ollama connectivity) |

### Modified Endpoints

| Method | Path | Change |
|--------|------|--------|
| `GET` | `/health` | Add `version` field to response |

### No MCP Tool Changes

All 22 existing MCP tools remain unchanged. The compile worker and triggers operate at the infrastructure layer, not the tool API layer.

---

## 14. Implementation Sequence

### DAG Task Graph

```
Phase 1 (Foundation — no dependencies)
├── T1: compile-worker.ts (SKIP LOCKED worker)
├── T2: 011-compile-triggers.sql (PG trigger)
└── T3: bundle-agent-defs.mjs (build script)

Phase 2 (Integration — depends on Phase 1)
├── T4: Enhanced seed-agent-definitions.ts (depends on T3)
│         Bundled JSON + embedding generation
├── T5: Enhanced config.ts (depends on T1)
│         COMPILE_WORKER_* fields
├── T6: Enhanced compile-queue.ts (depends on T1)
│         claimNextJob(), markDone(), markFailed()
└── T7: Enhanced index.ts startup (depends on T1, T4, T5, T6)
│         Worker start + agent def seeding in boot

Phase 3 (Shutdown — depends on Phase 2)
└── T8: Enhanced graceful shutdown (depends on T7)
          5-phase ordered drain

Phase 4 (Distribution — depends on Phase 3)
├── T9: docker-compose.standalone.yml (depends on T8)
├── T10: Dockerfile labels + healthcheck (depends on T8)
├── T11: .vscode/mcp.json (no deps — parallel with T9)
└── T12: README badges + config guide (depends on T9, T11)
```

### Critical Path

```
T1 → T5/T6 → T7 → T8 → T9 → T12
```

Estimated parallelizable groups:
- **Group A** (parallel): T1, T2, T3, T11
- **Group B** (parallel): T4, T5, T6
- **Group C** (sequential): T7 → T8 → T9 → T12

---

## 15. Fitness Functions

| Metric | Threshold | Measurement |
|--------|-----------|-------------|
| Startup time | < 30s (excluding model pull) | Time from `docker compose up` to `/health` returning 200 |
| Compile worker latency | < 10s per job (p95) | Time from job enqueue to `status='done'` |
| Shutdown time | < 30s | Time from SIGTERM to process exit |
| Queue dead-letter rate | < 5% | `failed / total` in compile queue |
| Agent def seeding | 100% coverage | All 14 agents present in DB after boot |
| Health check reliability | 99.9% | `/health` returns 200 when DB is connected |
| Docker image size | < 200MB | `docker images` runtime stage |
| Memory usage (idle) | < 256MB | Container RSS after boot, no active requests |
