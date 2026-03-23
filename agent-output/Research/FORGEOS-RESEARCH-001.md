# ForgeOS Technology Research Report

## Metadata

| Field | Value |
|-------|-------|
| **Ticket ID** | FORGEOS-RESEARCH-001 |
| **Research Analyst** | Research Agent |
| **Date** | 2026-03-05 |
| **Prior Belief** | ForgeOS architecture is sound; key technologies (MCP SDK, PostgreSQL, Docker Compose) are mature enough for production use — 65% confidence |
| **Posterior Belief** | Technologies are validated with caveats; PostgreSQL locking and MCP SDK are strong choices; auth requires careful design — 82% confidence |
| **Validity Window** | 6 months (expires 2026-09-05) |
| **Refresh Triggers** | MCP SDK major version bump, MCP auth spec finalization, PostgreSQL 18+ features |

---

## Executive Summary

This report researches and validates 6 technology areas for ForgeOS: MCP Server implementation, PostgreSQL distributed locking, Git webhook integration, authentication patterns, dashboard technologies, and Docker Compose multi-service patterns. All core technology choices are validated as sound. The primary risks are: (1) the MCP authorization specification is still evolving, (2) PostgreSQL as a job queue has throughput limits at scale, and (3) dashboard tech choices need to balance simplicity with real-time requirements. Overall confidence in the technology stack is **HIGH (82%)**.

---

## 1. MCP Server Implementation Best Practices

### Research Question
What is the current state of the MCP TypeScript SDK, and what are the best patterns for building a production MCP server with custom tools and a PostgreSQL backend?

### Prior Belief
MCP SDK is stable and well-documented — 60% confidence.

### Findings

#### 1.1 SDK Version & Health

| Metric | Value |
|--------|-------|
| **Package** | `@modelcontextprotocol/sdk` |
| **Latest Version** | 1.27.1 (published ~8 days ago as of 2026-03-05) |
| **Repository** | [modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk) |
| **Source Reputation** | HIGH — official Anthropic/MCP org |
| **Last Commit** | Active (within days) |
| **Contributors** | Multiple (>5) |
| **License** | MIT |
| **Known CVEs** | CVE-2025-66414 — DNS rebinding (fixed in v1.24.0) |
| **Code Snippets Available** | 266 |
| **Benchmark Score** | 77.7/100 |

**Assessment:** Actively maintained, high reputation, MIT license (compatible with any project license). The CVE was patched promptly, indicating healthy security response. **GREEN** — no disqualifying red flags.

#### 1.2 Package Structure (Post-Restructure)

The SDK has been restructured into scoped packages:

| Package | Purpose |
|---------|---------|
| `@modelcontextprotocol/server` | `McpServer` class, server logic |
| `@modelcontextprotocol/client` | `Client` class, client logic |
| `@modelcontextprotocol/node` | `StdioServerTransport`, `NodeStreamableHTTPServerTransport` |
| `@modelcontextprotocol/express` | Express middleware (`createMcpExpressApp`) |
| `@modelcontextprotocol/sdk` | Legacy umbrella (still works, re-exports sub-packages) |

**Recommendation:** Use the scoped packages (`@modelcontextprotocol/server`, `@modelcontextprotocol/node`) for tree-shaking and clarity. The umbrella `@modelcontextprotocol/sdk` still works but may be deprecated.

#### 1.3 Server Creation Pattern

```typescript
import { McpServer } from '@modelcontextprotocol/server';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { createMcpExpressApp } from '@modelcontextprotocol/express';
import * as z from 'zod/v4';

// Create server
const server = new McpServer({
  name: 'forgeos-orchestrator',
  version: '1.0.0'
}, {
  capabilities: { logging: {} }
});

// Register tools with Zod schema validation
server.registerTool(
  'claim-ticket',
  {
    title: 'Claim Ticket',
    description: 'Claim a ticket for processing by an agent',
    inputSchema: z.object({
      ticketId: z.string().describe('The ticket ID to claim'),
      agentName: z.string().describe('Agent claiming the ticket'),
      machineId: z.string().describe('Machine hostname'),
    }),
  },
  async ({ ticketId, agentName, machineId }) => {
    // PostgreSQL query to claim ticket with FOR UPDATE SKIP LOCKED
    const result = await claimTicket(ticketId, agentName, machineId);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result) }],
    };
  },
);
```

**Sources:** Official TypeScript SDK docs (weight: 1.0), Context7 code snippets (weight: 0.9)

#### 1.4 Transport Options

For ForgeOS, **Streamable HTTP** is the recommended transport (not stdio) because:
- ForgeOS needs multi-machine access over HTTP
- SSE (legacy) works but Streamable HTTP is the current standard
- Has built-in session management with `mcp-session-id` header
- Supports stateful and stateless modes

```typescript
// Express-based HTTP server with session management
const app = createMcpExpressApp(); // DNS rebinding protection built-in

const transports: Record<string, NodeStreamableHTTPServerTransport> = {};

app.post('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  if (sessionId && transports[sessionId]) {
    await transports[sessionId].handleRequest(req, res, req.body);
    return;
  }

  if (!sessionId && isInitializeRequest(req.body)) {
    const transport = new NodeStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => { transports[sid] = transport; }
    });
    transport.onclose = () => {
      if (transport.sessionId) delete transports[transport.sessionId];
    };
    const server = createForgeOSServer(); // Factory function
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    return;
  }

  res.status(400).json({ error: 'Invalid request' });
});

// SSE stream endpoint
app.get('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string;
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send('Invalid session');
    return;
  }
  await transports[sessionId].handleRequest(req, res);
});

app.listen(3011, '127.0.0.1');
```

**Sources:** Official SDK server.md docs (weight: 1.0), SDK examples (weight: 0.9)

#### 1.5 Tool Registration API

Two API styles are available:

**Style 1 — `registerTool()` (verbose, recommended for production)**
```typescript
server.registerTool('tool-name', {
  title: 'Human-readable Title',
  description: 'What this tool does',
  inputSchema: z.object({ param: z.string() }),
  outputSchema: z.object({ result: z.string() }),  // optional
}, async ({ param }, extra) => {
  return { content: [{ type: 'text', text: 'result' }] };
});
```

**Style 2 — `tool()` (shorthand)**
```typescript
server.tool('tool-name', { param: z.string() }, async ({ param }) => {
  return { content: [{ type: 'text', text: 'result' }] };
});
```

**Recommendation:** Use `registerTool()` for ForgeOS — it supports `outputSchema` for structured responses, which is valuable for machine-to-machine tool calls.

### Posterior Belief
MCP SDK is production-ready for ForgeOS use case — **85% confidence** (up from 60%).

**Delta justification:** Active maintenance, rich API surface, excellent documentation, known CVE already patched, MIT license. The restructured package system is clean. Only concern: rapid version iteration means API surface could shift in 6 months.

### Confidence: **HIGH (85%)**

---

## 2. PostgreSQL Distributed Locking Patterns

### Research Question
What are the best PostgreSQL patterns for distributed job queue locking, and how should ForgeOS implement lease-based ticket claiming?

### Prior Belief
PostgreSQL can handle distributed locking for ForgeOS scale — 70% confidence.

### Findings

#### 2.1 SELECT FOR UPDATE SKIP LOCKED

This is the **gold standard** pattern for PostgreSQL job queues. Used by Solid Queue (37signals), PgBoss, Inferable, and many production systems.

**Pattern:**
```sql
-- Claim a ticket atomically
WITH next_ticket AS (
    SELECT id
    FROM tickets
    WHERE status = 'READY'
      AND (claimed_by IS NULL OR lease_expiry < NOW())
    ORDER BY priority DESC, created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
)
UPDATE tickets
SET
    status = 'CLAIMED',
    claimed_by = $1,        -- agent worker ID
    machine_id = $2,        -- hostname
    operator = $3,           -- human operator
    lease_expiry = NOW() + INTERVAL '30 minutes',
    updated_at = NOW()
FROM next_ticket
WHERE tickets.id = next_ticket.id
RETURNING tickets.*;
```

**How it works:**
- `FOR UPDATE` acquires a row-level lock on matched rows
- `SKIP LOCKED` skips rows already locked by other transactions (no blocking!)
- Multiple workers can claim different tickets concurrently without contention
- The CTE + UPDATE pattern is atomic — find-and-claim in one statement

**Source:** Official PostgreSQL docs (weight: 1.0), Inferable.ai production usage (weight: 0.9), AmineDiro implementation guide (weight: 0.7)

#### 2.2 Lease-Based Distributed Locks

**Pattern for ForgeOS ticket leases:**
```sql
-- Lease expiry check for stale claim recovery
UPDATE tickets
SET
    status = 'READY',
    claimed_by = NULL,
    machine_id = NULL,
    lease_expiry = NULL
WHERE
    status = 'CLAIMED'
    AND lease_expiry < NOW();

-- Visibility timeout pattern (borrowed from SQS)
-- When claiming, set visible_at to future timestamp
UPDATE tickets
SET
    status = 'IN_PROGRESS',
    visible_at = NOW() + INTERVAL '30 minutes',
    retry_count = retry_count + 1
WHERE id IN (
    SELECT id FROM tickets
    WHERE status IN ('READY', 'CLAIMED')
      AND (visible_at IS NULL OR visible_at <= NOW())
      AND retry_count < 3
    LIMIT 1
    FOR UPDATE SKIP LOCKED
)
RETURNING *;
```

**Key considerations:**
- Lease duration should be configurable (default 30 min for ForgeOS matches the spec)
- Expired leases make tickets reclaimable — no external coordinator needed
- `retry_count` prevents infinite retry loops (max 3, then escalate — matches ForgeOS SDLC rules)

#### 2.3 Advisory Locks vs Row-Level Locks

| Aspect | Advisory Locks | Row-Level Locks (FOR UPDATE) |
|--------|---------------|------------------------------|
| **Latency** | 1-5ms | 2-20ms |
| **Scope** | Session or transaction | Transaction |
| **Use case** | Mutex for scheduled jobs | Job queue distribution |
| **Requires schema** | No (integer keys) | Yes (table rows) |
| **Visibility** | `pg_locks` | `pg_locks` |
| **SKIP LOCKED** | Not applicable | Yes |
| **ForgeOS fit** | Sync operations | ✅ **Ticket claiming** |

**Recommendation:** Use **row-level locks with `SKIP LOCKED`** for ticket claiming (primary use case). Consider advisory locks only for singleton operations (e.g., schema migrations, cron jobs).

**Source:** Architecture Weekly (weight: 0.7), SystemDr comparison (weight: 0.6), PostgreSQL official docs (weight: 1.0)

#### 2.4 Row-Level Security (RLS)

```sql
-- Enable RLS on tickets table
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;

-- Policy: agents can only see tickets in their current stage
CREATE POLICY agent_stage_access ON tickets
    FOR SELECT
    USING (
        current_setting('app.agent_role') = stage_owner
        OR current_setting('app.agent_role') = 'admin'
    );

-- Policy: agents can only modify tickets they've claimed
CREATE POLICY agent_claim_access ON tickets
    FOR UPDATE
    USING (
        claimed_by = current_setting('app.agent_id')
        OR current_setting('app.agent_role') = 'admin'
    );

-- Set session variables before queries
SET app.agent_role = 'Backend';
SET app.agent_id = 'backend-worker-1';
```

**Assessment:** RLS is excellent for ForgeOS multi-agent isolation, but adds ~5-10% query overhead. Worth it for security guarantees. **Recommend enabling RLS in production, optional in development.**

**Source:** Permit.io RLS guide (weight: 0.7), PostgreSQL official docs (weight: 1.0), OneUptime multi-tenant guide (weight: 0.6)

#### 2.5 Connection Pooling Strategy

| Option | Pros | Cons | ForgeOS Fit |
|--------|------|------|-------------|
| **node-postgres `pg.Pool`** | Built-in, zero config | Per-process only | Dev/single machine |
| **PgBouncer** | External pooler, multi-machine | Extra infra | ✅ **Production** |
| **Supavisor** | Modern, Elixir-based | Newer, less battle-tested | Future option |

**Recommendation:**
- **Development:** Use `pg.Pool` with `max: 20` connections per Node.js process
- **Production (multi-machine):** Deploy PgBouncer in `transaction` mode alongside PostgreSQL in Docker Compose
- Formula: `pool_size = (num_cores * 2) + effective_spindle_count` (PostgreSQL wiki recommendation)

```yaml
# docker-compose.yml snippet
pgbouncer:
  image: edoburu/pgbouncer:latest
  environment:
    DATABASE_URL: postgres://forgeos:password@postgres:5432/forgeos
    POOL_MODE: transaction
    DEFAULT_POOL_SIZE: 50
    MAX_CLIENT_CONN: 200
  depends_on:
    postgres:
      condition: service_healthy
```

**Source:** PgBouncer official docs (weight: 1.0), node-postgres GitHub issues (weight: 0.4), grizzlypeaksoftware guide (weight: 0.3)

#### 2.6 PgBoss — Alternative to Custom Implementation

| Metric | Value |
|--------|-------|
| **Package** | `pg-boss` |
| **Latest Version** | 12.14.0 |
| **License** | MIT |
| **Last Published** | ~5 days ago |
| **Stars** | >2,000 |

PgBoss is a mature PostgreSQL-backed job queue for Node.js that uses `SKIP LOCKED` internally. **Consider using PgBoss if ForgeOS needs a full job queue** rather than building a custom claim system. However, ForgeOS's ticket state machine is unique enough that a custom `SKIP LOCKED` implementation is likely better.

**Recommendation:** Custom implementation using `SKIP LOCKED` for ticket claiming; evaluate PgBoss only if generic background job processing is needed later.

### Posterior Belief
PostgreSQL distributed locking is excellent for ForgeOS scale — **88% confidence** (up from 70%).

**Delta justification:** `SKIP LOCKED` is battle-tested at production scale by multiple companies. RLS provides strong isolation guarantees. PgBouncer solves multi-machine connection pooling cleanly. Only risk: PostgreSQL as job queue doesn't scale beyond ~10K tickets/second (not a ForgeOS concern).

### Confidence: **HIGH (88%)**

---

## 3. Git Webhook Integration

### Research Question
How should ForgeOS handle GitHub webhook push events for state reconciliation?

### Prior Belief
Webhook integration is straightforward — 75% confidence.

### Findings

#### 3.1 GitHub Push Webhook Payload

The `push` event fires on any push to a repository. Key payload fields:

```json
{
  "ref": "refs/heads/main",
  "before": "abc123...",
  "after": "def456...",
  "commits": [
    {
      "id": "def456...",
      "message": "[FORGEOS-001] CLAIM by Backend on machine-1 (operator-1)",
      "timestamp": "2026-03-05T12:00:00Z",
      "author": { "name": "...", "email": "..." },
      "added": ["file1.ts"],
      "removed": [],
      "modified": ["file2.ts"]
    }
  ],
  "head_commit": {
    "id": "def456...",
    "message": "[FORGEOS-001] CLAIM by Backend on machine-1 (operator-1)"
  },
  "pusher": { "name": "...", "email": "..." },
  "repository": { "full_name": "org/forgeos", "default_branch": "main" }
}
```

**Source:** GitHub official docs (weight: 1.0)

#### 3.2 Commit Message Parsing

ForgeOS commit messages follow a strict format. Parsing regex:

```typescript
// CLAIM commit pattern
const CLAIM_REGEX = /^\[(?<ticketId>[A-Z]+-\d+)\] CLAIM by (?<agent>\w+) on (?<machine>[\w.-]+) \((?<operator>[\w.-]+)\)$/;

// WORK commit pattern  
const WORK_REGEX = /^\[(?<ticketId>[A-Z]+-\d+)\] (?<stage>\w+) complete by (?<agent>\w+) on (?<machine>[\w.-]+)$/;

function parseCommitMessage(message: string) {
  const claimMatch = message.match(CLAIM_REGEX);
  if (claimMatch) return { type: 'CLAIM', ...claimMatch.groups };
  
  const workMatch = message.match(WORK_REGEX);
  if (workMatch) return { type: 'WORK', ...workMatch.groups };
  
  return { type: 'UNKNOWN', raw: message };
}
```

#### 3.3 State Reconciliation Strategy

**Ghost commit recovery** — when the DB state diverges from Git state:

1. **Webhook receives push event** → parse commit messages
2. **Compare DB state vs commit claims** → identify discrepancies
3. **Reconciliation rules:**
   - If Git has CLAIM but DB doesn't → write claim to DB (Git is source of truth for claims)
   - If Git has WORK complete but DB still shows CLAIMED → advance ticket in DB
   - If DB has claim but no matching Git commit → expired lease, release in DB
4. **Idempotency:** All reconciliation operations should be idempotent (use `ON CONFLICT DO UPDATE`)

**Library recommendation:** Use `@octokit/webhooks` for type-safe webhook handling:

```typescript
import { Webhooks } from '@octokit/webhooks';

const webhooks = new Webhooks({ secret: process.env.WEBHOOK_SECRET! });

webhooks.on('push', async ({ payload }) => {
  for (const commit of payload.commits) {
    const parsed = parseCommitMessage(commit.message);
    if (parsed.type === 'CLAIM') {
      await reconcileClaimCommit(parsed, commit);
    } else if (parsed.type === 'WORK') {
      await reconcileWorkCommit(parsed, commit);
    }
  }
});
```

**`@octokit/webhooks` health:**
| Metric | Value |
|--------|-------|
| Maintainer | GitHub (Octokit org) |
| License | MIT |
| Source Reputation | HIGH |

**Source:** GitHub webhook docs (weight: 1.0), @octokit/webhooks GitHub (weight: 0.9), SO accepted answers (weight: 0.4)

### Posterior Belief
Webhook integration is well-supported — **82% confidence** (up from 75%).

**Delta justification:** GitHub webhook payloads are well-documented and stable. @octokit/webhooks provides type safety. The only complexity is the reconciliation logic, which is application-specific. Risk: webhook delivery is not guaranteed (GitHub retries, but eventual consistency).

### Confidence: **HIGH (82%)**

---

## 4. Authentication Patterns

### Research Question
What authentication approach should ForgeOS use for machine-to-machine agent communication with the MCP server?

### Prior Belief
JWT is the obvious choice — 55% confidence (uncertain because MCP auth spec is evolving).

### Findings

#### 4.1 Options Comparison Matrix

| Criterion (Weight) | API Keys | JWT (OAuth 2.0 Client Credentials) | OAuth 2.1 (MCP Spec) |
|---------------------|----------|--------------------------------------|----------------------|
| **Simplicity (0.25)** | 9/10 | 6/10 | 4/10 |
| **Security (0.25)** | 6/10 | 8/10 | 9/10 |
| **Revocability (0.15)** | 9/10 (individual) | 3/10 (must roll all) | 8/10 |
| **Standards compliance (0.15)** | 3/10 (no standard) | 8/10 (RFC 6749) | 10/10 (MCP spec) |
| **Implementation effort (0.10)** | 9/10 | 6/10 | 3/10 |
| **Scalability (0.10)** | 7/10 | 9/10 | 8/10 |
| **Weighted Score** | **7.05** | **6.65** | **6.60** |

#### 4.2 Analysis

**API Keys (Recommended for ForgeOS v1):**
- Simplest to implement; each agent/machine gets a unique key
- Keys stored hashed in PostgreSQL; validated on each MCP request
- Can be individually revoked without affecting other agents
- No external identity provider needed
- Fits ForgeOS's self-hosted model

**JWT (Client Credentials):**
- More complex: requires OAuth provider (Auth0, Cognito, or self-hosted)
- Tokens are not individually revocable
- Adds external dependency
- Better for multi-org setups (not needed for ForgeOS v1)

**OAuth 2.1 (MCP Spec):**
- The MCP specification (March 2025) introduced OAuth 2.1 support
- However, the spec is still evolving — current limitations are significant:
  - MCP server must act as both resource server AND authorization server
  - Requires implementing discovery, registration, and token endpoints
  - Community is actively debating improvements (GitHub issue #205)
- **NOT recommended for ForgeOS v1** — too immature and complex

**Source:** Auth0 MCP auth blog (weight: 0.7), Zuplo JWT vs API key (weight: 0.7), MCP spec (weight: 1.0), Descope OAuth vs API keys (weight: 0.6)

#### 4.3 Recommended Authentication Flow

```
┌─────────────┐     API Key in header     ┌──────────────────┐
│  AI Agent    │ ──────────────────────────▶│  ForgeOS MCP     │
│  (Client)    │     Authorization: Bearer  │  Server          │
│              │     <api-key>              │                  │
└─────────────┘                            │  1. Validate key │
                                           │  2. Look up agent│
                                           │  3. Check perms  │
                                           └──────────────────┘
```

Implementation:
```typescript
// Middleware for API key validation
async function validateApiKey(req: Request): Promise<AgentIdentity | null> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  
  const apiKey = authHeader.slice(7);
  const hashedKey = crypto.createHash('sha256').update(apiKey).digest('hex');
  
  const agent = await db.query(
    'SELECT id, name, role, permissions FROM agents WHERE api_key_hash = $1 AND revoked = false',
    [hashedKey]
  );
  
  return agent.rows[0] || null;
}
```

**Migration path:** Start with API keys for v1, prepare for OAuth 2.1 migration when MCP auth spec stabilizes. The migration is additive — API keys can coexist with OAuth tokens.

### Posterior Belief
API keys are the right choice for ForgeOS v1; OAuth 2.1 is the right long-term direction — **73% confidence** (up from 55%).

**Delta justification:** MCP auth spec is evolving too rapidly for adoption now. API keys are proven, simple, and revocable. The spec will likely stabilize in 6-12 months, at which point ForgeOS can adopt OAuth 2.1.

### Confidence: **MEDIUM-HIGH (73%)**

#### Contradiction Detected
- **FOR OAuth 2.1 now:** MCP spec recommends it; future-proof; standardized
- **AGAINST OAuth 2.1 now:** Spec is immature; server must be auth server; community debating alternatives
- **Classification:** Temporal — the spec will improve but isn't ready today
- **Resolution:** Phased approach — API keys now, OAuth 2.1 later

---

## 5. Dashboard Technologies

### Research Question
What lightweight dashboard technology should ForgeOS use for real-time pipeline visualization?

### Prior Belief
No strong prior — 40% confidence.

### Findings

#### 5.1 Options Comparison Matrix

| Criterion (Weight) | Vanilla HTML + SSE + D3.js | React + SSE + vis.js | htmx + SSE + Mermaid |
|---------------------|----------------------------|----------------------|----------------------|
| **Simplicity (0.30)** | 9/10 | 4/10 | 8/10 |
| **Real-time support (0.25)** | 9/10 (native SSE) | 8/10 | 7/10 |
| **Graph visualization (0.20)** | 9/10 (D3 force layout) | 8/10 | 5/10 (static only) |
| **Bundle size (0.15)** | 9/10 (~200KB) | 3/10 (~1MB+) | 7/10 (~50KB) |
| **No build step (0.10)** | 10/10 | 2/10 | 10/10 |
| **Weighted Score** | **9.05** | **5.25** | **7.15** |

#### 5.2 Recommendation: Vanilla HTML + SSE + D3.js

**Why:** ForgeOS is an infrastructure tool, not a consumer app. Heavy frameworks (React, Vue) add complexity without proportional value. The dashboard needs:
1. Real-time ticket pipeline status → **Server-Sent Events**
2. Dependency graph visualization → **D3.js force-directed graph**
3. No build step or npm frontend toolchain → **Vanilla HTML/JS**

**Server-Sent Events (SSE) implementation:**
```typescript
// Server side (Express)
app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  
  // Send initial state
  res.write(`data: ${JSON.stringify(await getTicketState())}\n\n`);
  
  // Subscribe to changes
  const unsubscribe = ticketEvents.subscribe((event) => {
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(event.data)}\n\n`);
  });
  
  req.on('close', unsubscribe);
});
```

```html
<!-- Client side -->
<script>
const events = new EventSource('/api/events');
events.addEventListener('ticket-update', (e) => {
  const data = JSON.parse(e.data);
  updateDashboard(data);
});
events.addEventListener('pipeline-change', (e) => {
  const data = JSON.parse(e.data);
  updateGraph(data);
});
</script>
```

**D3.js dependency graph:**

| Metric | Value |
|--------|-------|
| **Package** | `d3` |
| **Latest Version** | 7.x |
| **License** | ISC (permissive) |
| **Source Reputation** | HIGH (Observable/Mike Bostock) |
| **Bundle Size** | ~200KB (or use `d3-force` + `d3-selection` only: ~50KB) |

D3's force-directed graph module (`d3-force`) is ideal for visualizing ticket dependency DAGs. Can use `d3-dag` for proper DAG layouts.

**Source:** D3.js official site (weight: 1.0), web.dev SSE guide (weight: 0.9), Medium SSE articles (weight: 0.3)

### Posterior Belief
Vanilla + SSE + D3.js is the right stack for ForgeOS dashboard — **80% confidence** (up from 40%).

**Delta justification:** SSE is a perfect fit for unidirectional server→client updates (ticket state changes). D3.js is the gold standard for data viz with no framework lock-in. No build step keeps the project simple. Risk: D3.js has a learning curve for custom layouts.

### Confidence: **HIGH (80%)**

---

## 6. Docker Compose Multi-Service Patterns

### Research Question
What are the best patterns for composing PostgreSQL + Node.js services with proper startup ordering and volume management?

### Prior Belief
Docker Compose is well-documented for this — 80% confidence.

### Findings

#### 6.1 Recommended Docker Compose Configuration

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_DB: forgeos
      POSTGRES_USER: forgeos
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./db/init:/docker-entrypoint-initdb.d  # SQL init scripts
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 10s
      retries: 5
      start_period: 30s
      timeout: 10s
    secrets:
      - db_password

  pgbouncer:
    image: edoburu/pgbouncer:latest
    environment:
      DATABASE_URL: postgres://forgeos:password@postgres:5432/forgeos
      POOL_MODE: transaction
      DEFAULT_POOL_SIZE: 50
    depends_on:
      postgres:
        condition: service_healthy
    ports:
      - "6432:6432"

  mcp-server:
    build:
      context: .
      dockerfile: Dockerfile
    environment:
      DATABASE_URL: postgres://forgeos:password@pgbouncer:6432/forgeos
      NODE_ENV: production
      PORT: 3011
    depends_on:
      pgbouncer:
        condition: service_started
      postgres:
        condition: service_healthy
    ports:
      - "3011:3011"
    volumes:
      - git-repos:/app/repos  # Git repo mount point
      - ./config:/app/config:ro  # Read-only config
    restart: unless-stopped

volumes:
  pgdata:
    driver: local
  git-repos:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: ${GIT_REPOS_PATH:-./repos}

secrets:
  db_password:
    file: ./secrets/db_password.txt
```

**Source:** Docker official docs (weight: 1.0), docker-compose-healthcheck example (weight: 0.7)

#### 6.2 Key Patterns

**Health checks with `depends_on` conditions:**
- Use `condition: service_healthy` — Compose waits for healthcheck to pass
- PostgreSQL healthcheck: `pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}`
- `start_period: 30s` gives PostgreSQL time to initialize on first run
- `restart: true` on depends_on ensures dependent services restart when DB restarts

**Volume mounting for Git repos:**
- Use bind mount (not named volume) for Git repos so they're accessible from host
- Mount as read-write (default) so the MCP server can run git operations
- Use `driver_opts` with `type: none` and `o: bind` for explicit bind mounts
- Config files should be mounted `:ro` (read-only)

**Secrets management:**
- Use Docker secrets (`POSTGRES_PASSWORD_FILE`) instead of environment variables
- Secrets are mounted at `/run/secrets/` inside the container
- Never put passwords in `docker-compose.yml` directly

#### 6.3 Git Repository Volume Strategy

For ForgeOS, the MCP server needs access to Git repositories:

```yaml
# Option 1: Bind mount from host (recommended for development)
volumes:
  - ${WORKSPACE_PATH}:/app/workspace

# Option 2: Named volume with bind (recommended for production)
volumes:
  git-repos:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /var/forgeos/repos

# Option 3: Git clone at startup (recommended for CI/isolated environments)
# Use entrypoint script to clone repos on container start
```

**Recommendation:** Option 1 for development (developers' local repos), Option 2 for production (persistent across container rebuilds).

### Posterior Belief
Docker Compose patterns are well-established — **90% confidence** (up from 80%).

**Delta justification:** Docker Compose v2 with healthcheck conditions is mature and well-documented. The `depends_on` + `service_healthy` pattern is the standard approach. No significant risks.

### Confidence: **HIGH (90%)**

---

## 7. Weighted Comparison Summary

### Technology Stack Confidence Matrix

| Technology | Confidence | Risk Level | Validity Window | Notes |
|-----------|------------|------------|-----------------|-------|
| MCP TypeScript SDK v1.27+ | HIGH (85%) | LOW | 6 months | Active development; API may shift |
| PostgreSQL `SKIP LOCKED` | HIGH (88%) | LOW | 2 years | Battle-tested, stable PostgreSQL feature |
| PostgreSQL RLS | HIGH (85%) | LOW | 2 years | Stable PostgreSQL feature |
| PgBouncer connection pooling | HIGH (85%) | LOW | 2 years | Industry standard |
| API Key auth (v1) | MEDIUM-HIGH (73%) | MEDIUM | 12 months | Bridge to OAuth 2.1 |
| OAuth 2.1 MCP auth | LOW (40%) | HIGH | 3 months | Spec still evolving |
| SSE for real-time dashboard | HIGH (85%) | LOW | 2 years | Native browser API |
| D3.js for graph viz | HIGH (80%) | LOW | 2 years | Industry standard |
| Docker Compose orchestration | HIGH (90%) | LOW | 2 years | Mature platform |
| @octokit/webhooks | HIGH (82%) | LOW | 1 year | Official GitHub library |

### Overall Stack Confidence: **HIGH (82%)**

---

## 8. Risk Assessment

### 8.1 Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| MCP SDK breaking changes | MEDIUM | MEDIUM | Pin major version, follow release notes |
| MCP auth spec changes | HIGH | LOW (v1 uses API keys) | Defer OAuth 2.1 adoption to v2 |
| PostgreSQL as bottleneck at scale | LOW | MEDIUM | PgBouncer + read replicas if needed |
| DNS rebinding attack on MCP server | LOW | HIGH | Use `createMcpExpressApp()` (protection built-in since v1.24) |
| SSE connection limits per browser | LOW | LOW | Only 6 connections per domain; use single EventSource |
| D3.js learning curve for custom layouts | MEDIUM | LOW | Use `d3-dag` for pre-built DAG layouts |
| Docker volume permissions | MEDIUM | LOW | Set `user:` in docker-compose or fix permissions in Dockerfile |

### 8.2 Architectural Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Single PostgreSQL = SPOF | HIGH | HIGH | Plan for read replicas; monitor with pg_stat |
| Git webhook missed events | MEDIUM | MEDIUM | Periodic reconciliation sweep (cron) |
| Agent key compromise | LOW | HIGH | Hash keys, implement key rotation, audit logs |

---

## 9. Contradictions Found

| # | Claim | For | Against | Classification | Resolution |
|---|-------|-----|---------|----------------|------------|
| 1 | PostgreSQL as job queue | Proven pattern, ACID, no extra infra | Not designed for high-throughput queuing | Contextual — depends on scale | ForgeOS scale (100s of tickets) is well within PostgreSQL comfort zone |
| 2 | MCP OAuth 2.1 for auth | Spec-compliant, standardized | Spec immature, server must be auth server | Temporal — spec will improve | Use API keys now, plan migration |
| 3 | Vanilla JS vs React for dashboard | Simpler, no build step, lighter | Less maintainable for complex UIs | Contextual — depends on dashboard complexity | ForgeOS dashboard is relatively simple; Vanilla is sufficient |
| 4 | PgBouncer vs built-in pg.Pool | Handles multi-machine pooling | Adds infrastructure component | Contextual — depends on deployment model | Use pg.Pool for dev, PgBouncer for multi-machine production |

---

## 10. Sources Cited

| # | Source | Type | Weight | Recency |
|---|--------|------|--------|---------|
| 1 | MCP TypeScript SDK official docs (github.com/modelcontextprotocol/typescript-sdk) | Official docs | 1.0 | Active |
| 2 | MCP SDK npm registry (@modelcontextprotocol/sdk v1.27.1) | Official registry | 1.0 | 2026-02 |
| 3 | PostgreSQL 17 official docs — Explicit Locking | Official docs | 1.0 | Current |
| 4 | Inferable.ai blog — SKIP LOCKED effectiveness | Industry blog | 0.7 | 2025 |
| 5 | AmineDiro — Postgres job queue implementation | Personal blog | 0.3 | 2025-06 |
| 6 | Auth0 blog — MCP and Authorization | Official blog | 0.7 | 2025-04 |
| 7 | MCP Authorization Spec (spec.modelcontextprotocol.io) | Official spec | 1.0 | 2025-03 |
| 8 | Zuplo — JWT vs API Key for M2M | Industry blog | 0.7 | 2022-04 |
| 9 | Descope — OAuth vs API Keys for Agentic AI | Industry blog | 0.6 | 2025 |
| 10 | GitHub webhook docs (docs.github.com/en/webhooks) | Official docs | 1.0 | Current |
| 11 | Docker Compose startup order docs (docs.docker.com) | Official docs | 1.0 | 2025-12 |
| 12 | D3.js official site (d3js.org) | Official docs | 1.0 | Current |
| 13 | web.dev — SSE EventSource basics | Official guide | 0.9 | Current |
| 14 | Architecture Weekly — Distributed Locking guide | Industry blog | 0.7 | 2025 |
| 15 | CVE-2025-66414 — MCP SDK DNS rebinding | Security advisory | 1.0 | 2025 |
| 16 | SystemDr — Distributed Locking Mechanisms Compared | Industry blog | 0.6 | 2025 |
| 17 | Permit.io — Postgres RLS Implementation Guide | Industry blog | 0.7 | 2025 |
| 18 | Context7 — MCP TypeScript SDK code snippets | Documentation | 0.9 | Current |

---

## 11. Recommendations Summary

1. **MCP Server:** Use `@modelcontextprotocol/server` + `@modelcontextprotocol/node` with Streamable HTTP transport (Express). Use `registerTool()` for all ForgeOS operations. Pin to v1.27+. (**HIGH confidence**)

2. **PostgreSQL Locking:** Implement `SELECT FOR UPDATE SKIP LOCKED` for ticket claiming. Use 30-minute lease timeouts with retry_count. Enable RLS for agent isolation. (**HIGH confidence**)

3. **Connection Pooling:** pg.Pool for development; PgBouncer in transaction mode for production multi-machine deployment. (**HIGH confidence**)

4. **Authentication:** API keys (hashed, stored in PostgreSQL) for v1. Plan OAuth 2.1 migration when MCP auth spec stabilizes (~6-12 months). (**MEDIUM-HIGH confidence**)

5. **Dashboard:** Vanilla HTML + SSE + D3.js. No framework, no build step. Use `d3-force` for dependency graph visualization. (**HIGH confidence**)

6. **Docker Compose:** PostgreSQL + PgBouncer + MCP Server with healthcheck-based startup ordering. Bind mount for Git repos in dev, named volumes in production. (**HIGH confidence**)

7. **Webhooks:** Use `@octokit/webhooks` for GitHub push event handling. Implement periodic reconciliation as fallback. (**HIGH confidence**)
