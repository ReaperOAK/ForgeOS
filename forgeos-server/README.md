# ForgeOS MCP Server

[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_MCP_Server-0078d4?style=flat-square&logo=visual-studio-code&logoColor=white)](vscode:mcp/install?%7B%22name%22%3A%22forgeos%22%2C%22type%22%3A%22http%22%2C%22url%22%3A%22http%3A%2F%2Flocalhost%3A3011%2Fmcp%22%2C%22headers%22%3A%7B%22Authorization%22%3A%22Bearer%20%24%7Binput%3Aforgeos-api-key%7D%22%7D%7D)

Distributed ticket-lifecycle orchestration server for AI agents.
22 MCP tools over [Streamable HTTP](https://modelcontextprotocol.io/),
backed by PostgreSQL 17 + pgvector.

## Quick Start — Docker

```bash
# Download standalone compose (PostgreSQL + Ollama + MCP Server)
curl -fsSL https://raw.githubusercontent.com/reaperoak/ForgeOS/main/forgeos-server/docker-compose.standalone.yml \
  -o docker-compose.yml

# Start everything
docker compose up -d

# Verify
curl http://localhost:3011/ready
# => {"status":"ready","agents":14}
```

Auto-runs migrations, seeds 14 agent definitions with embeddings, pulls
Ollama models, and starts the compile worker on first boot.

## VS Code Setup (Safe — No Hardcoded Credentials)

### 1. Generate an admin token

```bash
echo "FORGEOS_ADMIN_TOKEN=$(openssl rand -hex 32)" >> .env
```

The server reads `FORGEOS_ADMIN_TOKEN` from `.env` at startup and uses it to
authenticate all MCP requests. The default `forgeos_admin_CHANGE_ME` (from
`ADMIN_API_KEY`) is used only if `FORGEOS_ADMIN_TOKEN` is not set.

### 2. Configure VS Code

Add to `.vscode/mcp.json` — the `${FORGEOS_ADMIN_TOKEN}` variable is resolved
from VS Code's process environment:

```jsonc
{
  "servers": {
    "forgeos": {
      "type": "http",
      "url": "http://localhost:3011/mcp",
      "headers": {
        "Authorization": "Bearer ${FORGEOS_ADMIN_TOKEN}"
      }
    }
  }
}
```

> **Security notes:**
> - `FORGEOS_ADMIN_TOKEN` must be exported in your shell or loaded via a VS
>   Code `.env` extension. It is **never** hardcoded in `mcp.json`.
> - The `.env.example` template ships with a placeholder
>   (`forgeos_admin_CHANGE_ME`). Replace it before starting the server.
> - `ADMIN_API_KEY` env var overrides the default for non-VS-Code usage.

### 3. Verify

Open the VS Code MCP panel or check DevTools console. You should see:

```
[forgeos] connected to http://localhost:3011/mcp
[forgeos] tools: tickets.next, tickets.claim, tickets.complete, …
```

## Quick Start — From Source

Requires Node.js ≥ 22 and PostgreSQL ≥ 15 with pgvector.

```bash
npm install
cp .env.example .env   # set DATABASE_URL at minimum
npm run migrate
npm run dev             # http://localhost:3011
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `tickets.next` | Find next available ticket for a stage |
| `tickets.claim` | Atomically claim a ticket with file-lock detection |
| `tickets.complete` | Advance ticket to next SDLC stage |
| `tickets.reject` | Reject and trigger rework or escalation |
| `tickets.update` | Update metadata on a claimed ticket |
| `tickets.spawn` | Create child ticket with dependency tracking |
| `tickets.extend` | Extend lease on a claimed ticket |
| `tickets.release` | Release a claim without advancing |
| `tickets.graph` | Return dependency graph (nodes + edges) |
| `tickets.stats` | Aggregate ticket statistics |
| `tickets.get` | Full ticket detail by ID |
| `tickets.list` | Filtered/paginated ticket listing |
| `tickets.attach_prompts` | Compile and attach prompts to READY tickets |
| `init.orient` | Auto-detect project framework, build system, entry points |
| `init.context` | Get contextual information for a file or ticket |
| `memory.store` | Store a lesson/insight for future agent use |
| `memory.recall` | Semantic search over stored lessons |
| `code.search` | Search code symbols across the indexed codebase |
| `code.locate` | Find symbol definitions and references |
| `code.explain` | Explain a code symbol or file in context |
| `code.symbols` | List symbols in a file |
| `code.dependencies` | Get import/dependency graph for a file |

## HTTP Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/mcp` | Bearer | MCP Streamable HTTP (tool invocation) |
| `GET` | `/mcp` | Bearer | MCP SSE transport |
| `GET` | `/health` | Public | Health check with DB status |
| `GET` | `/ready` | Public | Readiness probe (DB + agents) |
| `GET` | `/dashboard` | Public | Live Kanban board |
| `GET` | `/events` | Public | SSE stream of ticket changes |
| `GET` | `/api/tickets` | Bearer | Paginated ticket list |
| `GET` | `/api/tickets/:id` | Bearer | Ticket detail |
| `GET` | `/api/stages` | Bearer | Pipeline overview |
| `POST` | `/api/admin/agents` | Admin | Register agent (returns API key) |
| `POST` | `/api/webhooks/github` | HMAC | Push event reconciliation |

## Configuration

Environment variables (`.env` supported). Zod-validated at startup.

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | *(required)* | PostgreSQL connection string |
| `PORT` | `3011` | HTTP listen port |
| `NODE_ENV` | `development` | `development` / `production` / `test` |
| `ADMIN_API_KEY` | `forgeos_admin_CHANGE_ME` | Admin key (must change in prod) |
| `LOG_LEVEL` | `info` | Pino log level |
| `WEBHOOK_SECRET` | — | GitHub webhook HMAC secret (required in prod) |
| `GEMINI_API_KEY` | — | Enables Gemini-first prompt compilation |
| `RATE_LIMIT_PER_MINUTE` | `100` | Max requests/min per client |
| `DEFAULT_LEASE_MINUTES` | `30` | Ticket claim lease duration |
| `MAX_LEASE_MINUTES` | `120` | Max lease extension |
| `COMPILE_WORKER_ENABLED` | `true` | Enable background prompt compile worker |
| `EMBEDDING_PROVIDER` | `ollama` | Embedding provider (`ollama` or `openai`) |
| `OLLAMA_BASE_URL` | `http://localhost:11434/api/embed` | Ollama embedding endpoint |

## Architecture

```
src/
├── index.ts              # Boot, graceful shutdown, compile worker
├── server.ts             # Express app, MCP endpoint, SSE, NOTIFY
├── config.ts             # Zod-validated env config
├── api/routes/           # REST endpoints (tickets, stages, events, admin)
├── db/
│   ├── pool.ts           # PG connection pool, RLS helpers
│   ├── migrate.ts        # SQL migration runner
│   ├── migrations/       # 013 migration files
│   ├── seed.ts           # Default project + admin agent
│   ├── seed-agent-definitions.ts  # 14 bundled agent definitions
│   └── file-mutex.ts     # File-level concurrent lock management
├── middleware/            # Auth, logging, error handling, validation
├── tools/                # MCP tool handlers (22 tools)
├── services/
│   ├── compiler.ts       # Prompt compilation + persistence
│   ├── compile-worker.ts # Durable queue worker (SKIP LOCKED)
│   └── compile-orchestrator.ts  # Hash-based freshness gate
└── dashboard/            # Static Kanban UI (HTML/CSS/JS)
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run dev` | Dev mode with hot-reload |
| `npm run migrate` | Run pending DB migrations |
| `npm test` | Run test suite |
| `npm run lint` | ESLint |
| `npm run typecheck` | Type-check without emit |

## Docker

```bash
# Build
docker build -t forgeos/mcp-server .

# Run (standalone compose includes PostgreSQL + Ollama)
docker compose -f docker-compose.standalone.yml up -d
```

The standalone compose pulls models automatically. GPU support is optional —
remove the `deploy.resources` block from the Ollama service if no NVIDIA GPU.

## License

See the repository root for license details.
