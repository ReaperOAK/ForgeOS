# MCP Server Distribution Research Brief

**Research Analyst:** Research Agent  
**Date:** 2026-03-23  
**Prior Confidence:** 40% (limited prior knowledge of MCP distribution patterns)  
**Posterior Confidence:** 92% (HIGH — comprehensive multi-source evidence gathered)  
**Validity Window:** 6 months (MCP ecosystem evolving rapidly)  
**Refresh Trigger:** New MCP SDK major version, new VS Code MCP features, registry GA

---

## Executive Summary

The MCP ecosystem has matured significantly. There are **three primary distribution channels** for MCP servers: **npm packages (stdio)**, **Docker images (stdio)**, and **remote HTTP servers (Streamable HTTP)**. VS Code supports all three via `.vscode/mcp.json` with one-click install badges. The official MCP Registry (`registry.modelcontextprotocol.io`) is in preview. For ForgeOS, the recommended strategy is a **dual-distribution approach**: npm package for simple deployments + Docker Compose for full-stack (PostgreSQL + server).

---

## Topic 1: Standalone MCP Server Distribution Patterns

### Research Question
How do existing MCP servers distribute themselves as standalone packages?

### Key Findings

**Three dominant distribution patterns exist:**

| Pattern | Transport | User Setup | Examples |
|---------|-----------|------------|----------|
| **npm/npx** | stdio | `npx -y @org/server` | @modelcontextprotocol/server-filesystem, Playwright MCP |
| **Docker** | stdio | `docker run -i --rm image` | ghcr.io/github/github-mcp-server |
| **Remote HTTP** | Streamable HTTP / SSE | URL in config | GitHub Copilot MCP (api.githubcopilot.com/mcp/) |

**Evidence:**

1. **npm/npx pattern (most common for JS/TS servers)**
   - Source: npmjs.com, AI Hero publishing guide, VS Code docs
   - User runs: `npx -y @modelcontextprotocol/server-filesystem /path/to/dir`
   - VS Code config adds to `mcp.json`: `{"command": "npx", "args": ["-y", "package-name"]}`
   - The `-y` flag auto-confirms install
   - Confidence: 95% — this is the de facto standard for TypeScript MCP servers

2. **Docker pattern (used by GitHub MCP after April 2025)**
   - Source: github/github-mcp-server docs, Docker MCP Toolkit
   - GitHub deprecated the npm package in April 2025, moved to Docker + Go binary
   - Docker label required for registry: `LABEL io.modelcontextprotocol.server.name="io.github.org/server"`
   - Config: `{"command": "docker", "args": ["run", "-i", "--rm", "-e", "ENV_VAR", "image:tag"]}`
   - Docker MCP Toolkit allows one-click Docker Desktop integration
   - Confidence: 90%

3. **Remote HTTP pattern (emerging for hosted services)**
   - Source: VS Code docs, GitHub Copilot MCP, SailPoint MCP
   - Config: `{"type": "http", "url": "https://api.example.com/mcp/"}`
   - Supports OAuth 2.0 for authentication
   - No local installation needed
   - Confidence: 85%

4. **Go binary pattern (niche, used by GitHub)**
   - Source: github/github-mcp-server
   - Distributed via GitHub Releases as precompiled binaries
   - Config: `{"command": "/path/to/binary", "args": ["stdio"]}`

### Recommendation for ForgeOS

**Primary:** npm package with `npx` support (lowest barrier to entry)  
**Secondary:** Docker image via `ghcr.io` (for users who need PostgreSQL)  
**Tertiary:** Remote HTTP for hosted/cloud deployments  

Confidence: 92%

---

## Topic 2: One-Click Add to VS Code

### Research Question
How does the VS Code MCP "one-click install" pattern work?

### Key Findings

**1. URI Scheme: `vscode:mcp/install`**

VS Code supports a deep-link URI scheme for one-click MCP server installation:

```
vscode:mcp/install?%7B%22name%22%3A%22my-server%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22my-package%22%5D%7D
```

The URI contains URL-encoded JSON of the server configuration. When clicked:
1. Opens VS Code
2. Prompts user to install the MCP server
3. Adds config to user or workspace `mcp.json`

Source: vscodemcp.com, jamesmontemagno/mcp-badge-creator, VS Code docs

**2. Badge/Button for README**

Two tools exist for generating badges:
- **vscodemcp.com** — Web-based generator for Shields.io badges
- **jamesmontemagno/mcp-badge-creator** — More comprehensive, supports multiple IDEs

Example Markdown for README:
```markdown
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_MCP_Server-0078d4?style=flat-square&logo=visual-studio-code&logoColor=white)](vscode:mcp/install?%7B%22name%22%3A%22forgeos%22%2C%22type%22%3A%22http%22%2C%22url%22%3A%22http%3A%2F%2Flocalhost%3A3011%2Fmcp%22%7D)
```

**3. Configuration File Locations**

| Location | Purpose | Scope |
|----------|---------|-------|
| `.vscode/mcp.json` | Project-level, shared via source control | Workspace |
| `~/.config/Code/User/mcp.json` (Linux) | User-level, across all workspaces | Global |
| Per-profile `mcp.json` | Profile-specific | Profile |

**4. Configuration Schema**

```jsonc
// .vscode/mcp.json (workspace)
{
  "servers": {
    "forgeos": {
      // Option A: stdio via npx
      "command": "npx",
      "args": ["-y", "@forgeos/mcp-server"],
      "env": {
        "DATABASE_URL": "${input:database-url}"
      }
    },
    "forgeos-http": {
      // Option B: remote HTTP
      "type": "http",
      "url": "http://localhost:3011/mcp"
    },
    "forgeos-docker": {
      // Option C: Docker
      "command": "docker",
      "args": ["run", "-i", "--rm", "-e", "DATABASE_URL", "ghcr.io/forgeos/mcp-server"],
      "env": {
        "DATABASE_URL": "${input:database-url}"
      }
    }
  }
}
```

**5. Key Configuration Fields**

| Field | Required | Description |
|-------|----------|-------------|
| `type` | For HTTP, yes (`"http"`) | Server connection type; stdio servers omit this |
| `command` | For stdio, yes | Command to start server (`npx`, `node`, `docker`, `python`) |
| `args` | No | Arguments passed to command |
| `url` | For HTTP, yes | Server URL |
| `env` | No | Environment variables; supports `${input:name}` for prompts |
| `envFile` | No | Path to `.env` file |
| `headers` | For HTTP, no | Custom headers (e.g., auth tokens) |

**6. Input Variables for Sensitive Config**

VS Code supports `${input:variable-name}` syntax that prompts the user:
```json
{
  "env": {
    "API_KEY": "${input:api-key}",
    "DATABASE_URL": "${input:database-url}"
  }
}
```

Source: VS Code MCP configuration reference (code.visualstudio.com)

### Recommendation for ForgeOS

1. Create a `.vscode/mcp.json` example in the repo for workspace setup
2. Add one-click install badges to README for all three distribution methods
3. Use `${input:...}` variables for sensitive config (DATABASE_URL, API keys)
4. Generate badges using the Shields.io pattern established by the community

Confidence: 95%

---

## Topic 3: MCP Server as npm Package

### Research Question
How to package an MCP server as an npm package for npx distribution?

### Key Findings

**1. Package.json Pattern**

The standard pattern uses the `bin` field to make the package executable via `npx`:

```json
{
  "name": "@forgeos/mcp-server",
  "version": "1.0.0",
  "description": "ForgeOS MCP Server — Distributed AI Agent Orchestration",
  "type": "module",
  "main": "dist/index.js",
  "bin": {
    "forgeos-mcp-server": "./dist/index.js"
  },
  "files": [
    "dist",
    "README.md",
    "LICENSE"
  ],
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "prepublishOnly": "npm run build"
  },
  "keywords": [
    "mcp",
    "modelcontextprotocol",
    "server",
    "forgeos",
    "agent-orchestration"
  ],
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.27.1",
    "express": "^4.21.2",
    "pg": "^8.13.1",
    "pino": "^9.6.0",
    "zod": "^3.24.2"
  },
  "engines": {
    "node": ">=22.0.0"
  }
}
```

Source: Twitter MCP example, AI Hero publishing guide, @modelcontextprotocol/server-github npm page

**2. Entry Point Pattern**

The entry point file (`dist/index.js`) must:
- Have a shebang line: `#!/usr/bin/env node`
- Start the MCP server on stdio or HTTP based on arguments
- Handle environment variables for configuration

```typescript
#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({
  name: "forgeos",
  version: "1.0.0",
});

// Register tools...
server.tool("tickets_list", { /* schema */ }, async (args) => { /* handler */ });

const transport = new StdioServerTransport();
await server.connect(transport);
```

**3. stdio vs HTTP Distribution**

| Aspect | stdio (npx) | HTTP (remote) |
|--------|------------|---------------|
| Transport | stdin/stdout JSON-RPC | HTTP + SSE |
| Setup | Zero-config, `npx -y pkg` | Requires running server + URL |
| State | Ephemeral per session | Persistent, shared |
| Dependencies | Can't easily use databases | Full server with databases |
| Auth | Via env vars to process | OAuth 2.0, API keys, headers |
| Best for | Lightweight, stateless tools | Stateful services needing DB |

**4. Critical Decision: ForgeOS Needs PostgreSQL**

ForgeOS is stateful — it needs PostgreSQL for ticket management. This means:
- **Pure npx stdio** won't work for the full server (no PostgreSQL)
- **npx can work** as a thin client/proxy that connects to a running ForgeOS instance
- **Docker Compose** is the natural fit for full-stack deployment

**Recommended Dual Strategy:**
1. `@forgeos/mcp-server` npm package that supports:
   - `--mode=http-client` → connects to existing ForgeOS HTTP server (npx-friendly)
   - `--mode=standalone` → starts embedded server with SQLite or connects to PostgreSQL URL
2. Docker Compose for full production stack

**5. MCP Registry Verification**

For publishing to the official MCP Registry, add `mcpName` field to `package.json`:
```json
{
  "mcpName": "io.github.forgeos/mcp-server"
}
```

Source: modelcontextprotocol/registry package ownership docs

**6. Environment Variables Pattern**

```typescript
// Standard pattern: read from process.env
const config = {
  databaseUrl: process.env.DATABASE_URL || "postgresql://localhost:5432/forgeos",
  port: parseInt(process.env.PORT || "3011"),
  logLevel: process.env.LOG_LEVEL || "info",
};
```

Users configure via `env` in mcp.json:
```json
{
  "env": {
    "DATABASE_URL": "${input:forgeos-db-url}",
    "FORGEOS_API_KEY": "${input:forgeos-api-key}"
  }
}
```

### Recommendation for ForgeOS

Publish `@forgeos/mcp-server` to npm with dual-mode support:
- **Client mode** (npx-friendly): Connects to existing ForgeOS HTTP endpoint
- **Full mode** (needs Docker/PostgreSQL): Runs the complete server

Confidence: 88%

---

## Topic 4: MCP Server as Docker Image

### Research Question
How do Docker-based MCP servers integrate with VS Code?

### Key Findings

**1. Docker stdio Integration Pattern**

VS Code supports Docker-based MCP servers via stdio transport:

```json
{
  "servers": {
    "forgeos": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "DATABASE_URL",
        "-e", "FORGEOS_API_KEY",
        "--network", "host",
        "ghcr.io/forgeos/mcp-server:latest"
      ],
      "env": {
        "DATABASE_URL": "postgresql://localhost:5432/forgeos",
        "FORGEOS_API_KEY": "${input:forgeos-api-key}"
      }
    }
  }
}
```

Key flags:
- `-i` (interactive) — required for stdio
- `--rm` — cleanup on exit
- `-e VAR` — pass environment variables through
- `--network host` — for connecting to host PostgreSQL

Source: GitHub MCP Server Docker config, PostgreSQL MCP Server examples

**2. Docker Compose for Full Stack**

For ForgeOS (which needs PostgreSQL + Ollama), Docker Compose is ideal:

```yaml
# docker-compose.mcp.yml (user-facing, minimal)
services:
  forgeos-mcp:
    image: ghcr.io/forgeos/mcp-server:latest
    ports:
      - "3011:3011"
    environment:
      - DATABASE_URL=postgresql://forgeos:forgeos@postgres:5432/forgeos
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3011/health"]
      interval: 10s
      timeout: 5s
      retries: 3

  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_DB: forgeos
      POSTGRES_USER: forgeos
      POSTGRES_PASSWORD: forgeos
    volumes:
      - forgeos-pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U forgeos"]
      interval: 5s

volumes:
  forgeos-pgdata:
```

Then VS Code connects via HTTP:
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

**3. Docker MCP Toolkit**

Docker Desktop has a built-in MCP Toolkit:
- Browse and launch MCP servers from Docker Desktop
- One-click connection to Claude Desktop, VS Code, Cursor
- Command: `docker mcp client connect vscode`
- ForgeOS could be listed in the Docker MCP catalog

Source: Docker blog, Docker MCP Toolkit docs

**4. Dockerfile Best Practices**

GitHub's MCP server Dockerfile demonstrates the multi-stage pattern:
```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY dist/ ./dist/

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app .

# Required MCP registry annotation
LABEL io.modelcontextprotocol.server.name="io.github.forgeos/mcp-server"

EXPOSE 3011
HEALTHCHECK --interval=10s --timeout=5s CMD wget -qO- http://localhost:3011/health || exit 1
ENTRYPOINT ["node", "dist/index.js"]
CMD ["--mode=http"]
```

**5. Docker vs docker-compose UX**

| Approach | UX | Good For |
|----------|-----|----------|
| Single `docker run` | Simple, one command | Stateless servers |
| `docker compose up` | Needs compose file | Servers with databases |
| Docker MCP Toolkit | GUI, one-click | Desktop users |
| Remote HTTP | No Docker needed | Cloud-hosted servers |

### Recommendation for ForgeOS

1. Publish Docker image to `ghcr.io/forgeos/mcp-server`
2. Provide minimal `docker-compose.mcp.yml` for one-command full-stack setup
3. Add `LABEL io.modelcontextprotocol.server.name` for registry compatibility
4. Support both stdio and HTTP modes in the same image (`CMD ["stdio"]` default)
5. Include healthcheck in Dockerfile

Confidence: 90%

---

## Topic 5: Production Readiness Checklist

### Research Question
What makes an MCP server production-ready?

### Key Findings

**1. MCP SDK Tool Registration Pattern**

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const server = new McpServer({
  name: "forgeos",
  version: "1.0.0",
  capabilities: {
    tools: {},
    resources: {},
  },
});

// Tool with Zod schema validation
server.tool(
  "tickets_list",
  "List tickets with optional filters",
  {
    stage: z.enum(["READY", "BACKEND", "QA", "DONE"]).optional(),
    status: z.enum(["READY", "CLAIMED", "IN_PROGRESS"]).optional(),
    limit: z.number().min(1).max(200).default(50),
  },
  async ({ stage, status, limit }) => {
    try {
      const tickets = await ticketService.list({ stage, status, limit });
      return { content: [{ type: "text", text: JSON.stringify(tickets) }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  }
);
```

**2. Error Handling**

MCP SDK error responses use `isError: true`:
```typescript
// Structured error response
return {
  content: [{ type: "text", text: JSON.stringify({ error: "Not found", code: 404 }) }],
  isError: true,
};
```

Best practices (from OWASP MCP checklist, SlowMist security checklist):
- Validate all inputs server-side (never trust client-provided data)
- Return structured errors without exposing internals
- Log errors with context but sanitize sensitive data
- Use error boundaries to prevent cascading failures

**3. Health Checks**

Two tiers recommended:
```typescript
// Liveness: server process is running
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', version: '1.0.0' });
});

// Readiness: dependencies are available
app.get('/ready', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'ready' });
  } catch (error) {
    res.status(503).json({ status: 'not_ready', error: error.message });
  }
});
```

Source: fast.io MCP health check guide

**4. Authentication Patterns**

| Pattern | Use Case | MCP Support |
|---------|----------|-------------|
| **API Keys** | Simple, per-user | Via `env` in mcp.json or headers |
| **OAuth 2.0** | Hosted/cloud servers | Native MCP spec support |
| **Bearer tokens** | Machine-to-machine | Via `headers` in mcp.json |
| **mTLS** | Enterprise, high-security | Infrastructure-level |

The official MCP spec recommends OAuth 2.0 for remote servers. The `example-remote-server` repo demonstrates a reference implementation with separate auth server.

40% of MCP servers use API keys. 24% use no authentication at all (source: Zuplo MCP Report).

**5. Rate Limiting**

```typescript
import { rateLimit } from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/mcp', limiter);
```

**6. Graceful Shutdown**

```typescript
const server = app.listen(port);

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(() => {
    pool.end().then(() => {
      logger.info('Database pool closed');
      process.exit(0);
    });
  });
  // Force exit after 10 seconds
  setTimeout(() => process.exit(1), 10000);
});
```

GitHub's server demonstrates this with `signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)`.

**7. Connection Pooling**

ForgeOS already uses pg connection pool. Key settings:
```typescript
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,              // max pool size
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});
```

**8. Logging Standards**

MCP SDK uses structured logging. ForgeOS already uses pino:
```typescript
import pino from 'pino';
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV === 'development'
    ? { target: 'pino-pretty' }
    : undefined,
});
```

Audit logging requirements (from security checklists):
- Log all tool invocations
- Log authentication attempts
- Log errors with correlation IDs
- 90-day retention minimum
- Never log secrets/tokens

**9. Complete Production Readiness Checklist**

| Category | Item | Priority |
|----------|------|----------|
| **Security** | Input validation on all tools | HIGH |
| **Security** | Authentication (API key or OAuth) | HIGH |
| **Security** | No hardcoded secrets | HIGH |
| **Security** | Rate limiting | MEDIUM |
| **Security** | CORS configuration | MEDIUM |
| **Reliability** | Health check endpoint (/health, /ready) | HIGH |
| **Reliability** | Graceful shutdown (SIGTERM) | HIGH |
| **Reliability** | Connection pooling | HIGH |
| **Reliability** | Error handling (isError responses) | HIGH |
| **Reliability** | Timeout configuration | MEDIUM |
| **Observability** | Structured logging (pino/winston) | HIGH |
| **Observability** | Tool invocation audit log | MEDIUM |
| **Observability** | Correlation IDs | MEDIUM |
| **Distribution** | Dockerfile with HEALTHCHECK | HIGH |
| **Distribution** | npm package with bin entry | HIGH |
| **Distribution** | One-click VS Code badge | MEDIUM |
| **Distribution** | server.json for MCP Registry | MEDIUM |
| **Documentation** | README with setup instructions | HIGH |
| **Documentation** | Environment variable documentation | HIGH |
| **Documentation** | Tool descriptions (for LLM and humans) | HIGH |

### Recommendation for ForgeOS

ForgeOS already has most of these (Express, pg pool, pino, health checks). Key gaps to address:
1. Add `isError: true` structured error responses to all tool handlers
2. Add API key authentication middleware for remote access
3. Add rate limiting
4. Create `/health` and `/ready` endpoints if not present
5. Add SIGTERM graceful shutdown handler
6. Add MCP server annotations/descriptions for LLM consumption

Confidence: 93%

---

## Topic 6: MCP Registry / Discovery

### Research Question
How do users discover MCP servers? Is there an official registry?

### Key Findings

**1. Official MCP Registry (Preview)**

- URL: `https://registry.modelcontextprotocol.io`
- Status: Preview (breaking changes possible)
- Backed by: Anthropic, GitHub, Microsoft, PulseMCP
- Source: modelcontextprotocol/registry GitHub repo
- CLI tool: `mcp-publisher`

**2. Publishing Process**

```bash
# 1. Install the publisher CLI
go install github.com/modelcontextprotocol/registry/cmd/publisher@latest

# 2. Initialize server.json
mcp-publisher init

# 3. Authenticate (GitHub OAuth for io.github.* namespaces)
mcp-publisher login --method github

# 4. Publish
mcp-publisher publish
```

**3. Required Metadata (server.json)**

```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-07-09/server.schema.json",
  "name": "io.github.forgeos/mcp-server",
  "description": "ForgeOS — Distributed MCP Orchestration Server for AI Agent Development",
  "repository": {
    "url": "https://github.com/forgeos/forgeos",
    "source": "github"
  },
  "version": "1.0.0",
  "packages": [
    {
      "registry_type": "npm",
      "identifier": "@forgeos/mcp-server",
      "version": "1.0.0",
      "transport": {
        "type": "stdio"
      },
      "environment_variables": [
        {
          "name": "DATABASE_URL",
          "description": "PostgreSQL connection string",
          "is_required": true,
          "is_secret": true
        }
      ]
    },
    {
      "registry_type": "oci",
      "identifier": "forgeos/mcp-server",
      "version": "1.0.0"
    }
  ]
}
```

**4. Package Ownership Verification**

Each registry type has a verification mechanism:
- **npm**: Add `"mcpName": "io.github.forgeos/mcp-server"` to package.json
- **Docker/OCI**: Add `LABEL io.modelcontextprotocol.server.name="io.github.forgeos/mcp-server"` to Dockerfile
- **PyPI**: Add `mcp-name: io.github.forgeos/mcp-server` to README

**5. Namespace Authentication**

- `io.github.username/*` → GitHub OAuth (automatic)
- `com.yourdomain/*` → DNS TXT record or HTTP verification

**6. Other Registries**

| Registry | Focus | Size |
|----------|-------|------|
| **GitHub MCP Registry** | github.com integration, Copilot | Canonical, code-transparent |
| **MCP.SO** | Usage-driven rankings | Large, call-based ranking |
| **Glama** | Curated directory | ~10,000 servers |
| **mcp-servers-hub** | Community aggregator | Broad |
| **Docker MCP Catalog** | Docker Desktop integration | Growing |
| **Official MCP Registry** | Standardized metadata + CLI | Preview, backed by Anthropic+GitHub |
| **VS Code MCP Gallery** | In-editor browsing | Native VS Code integration |

VS Code has a built-in MCP server gallery: `MCP: Browse MCP Servers` command.

**7. 17,000+ MCP Servers**

Over 17,000 MCP servers are now publicly listed across registries (source: Zuplo MCP Report).

### Recommendation for ForgeOS

1. Publish to the official MCP Registry using `mcp-publisher`
2. Use `io.github.forgeos/mcp-server` as the canonical namespace
3. Add `mcpName` to package.json for npm verification
4. Add Docker label for OCI verification
5. List on GitHub MCP Registry for maximum visibility
6. Add VS Code gallery metadata for in-editor discovery

Confidence: 90%

---

## Weighted Comparison Matrix: Distribution Strategy for ForgeOS

| Criterion (Weight) | npm/npx (stdio) | Docker Compose | Remote HTTP | Score |
|---------------------|----------------|----------------|-------------|-------|
| **Ease of Setup (0.25)** | 9/10 (one command) | 6/10 (needs Docker) | 8/10 (just URL) | — |
| **Full Features (0.25)** | 4/10 (no PostgreSQL) | 10/10 (full stack) | 10/10 (full stack) | — |
| **VS Code Integration (0.20)** | 9/10 (native) | 7/10 (docker command) | 9/10 (native http) | — |
| **Production Ready (0.15)** | 5/10 (ephemeral) | 9/10 (persistent) | 9/10 (persistent) | — |
| **Discovery (0.15)** | 9/10 (npm + registry) | 7/10 (Docker Hub) | 6/10 (needs hosting) | — |
| **Weighted Total** | **7.0** | **8.0** | **8.5** | — |

### Recommended Architecture

```
┌─────────────────────────────────────────────────┐
│                  User Chooses                     │
├─────────────┬──────────────┬─────────────────────┤
│  Quick Try  │  Self-Host   │    Cloud/Team        │
│  (npx)      │  (Docker)    │    (Remote HTTP)     │
├─────────────┼──────────────┼─────────────────────┤
│ npx -y      │ docker       │ URL in mcp.json      │
│ @forgeos/   │ compose up   │ https://forgeos.io/  │
│ mcp-server  │              │ mcp                  │
│             │              │                      │
│ Connects to │ Full stack:  │ Hosted ForgeOS       │
│ remote URL  │ PG + Server  │ instance             │
│ or SQLite   │ + Dashboard  │                      │
└─────────────┴──────────────┴─────────────────────┘
```

---

## Contradictions Found

| Claim | For | Against | Resolution |
|-------|-----|---------|------------|
| npm is the standard | Most MCP servers use npm | GitHub deprecated their npm package | **Contextual**: GitHub switched because their server is Go-based. TypeScript servers should still use npm. |
| Stdio is best | Simplest setup, universal | Can't persist state | **Genuine**: ForgeOS needs PostgreSQL, so pure stdio is insufficient. Use stdio as thin client. |
| Docker is complex | More steps than npx | Full isolation + dependencies | **Contextual**: Docker Compose reduces complexity. Necessary for stateful servers. |

---

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| MCP Registry is still preview | Medium | Medium | Support direct mcp.json config too |
| MCP spec breaking changes | High | Low | Pin SDK version, watch spec updates |
| Docker not available on all systems | Medium | Medium | Provide npm + remote HTTP alternatives |
| Security vulnerabilities (30+ CVEs in 2026) | High | Medium | Follow OWASP MCP checklist, input validation |
| User confusion about PostgreSQL requirement | Medium | High | Clear docs, npx mode that connects to remote |

---

## Implementation Priorities

1. **Phase 1:** Add Streamable HTTP transport to ForgeOS server (if not present)
2. **Phase 2:** Create `@forgeos/mcp-server` npm package with `bin` entry
3. **Phase 3:** Create optimized Dockerfile with health check + MCP label
4. **Phase 4:** Create user-facing `docker-compose.mcp.yml`
5. **Phase 5:** Generate one-click VS Code install badges for README
6. **Phase 6:** Create `server.json` and publish to MCP Registry
7. **Phase 7:** Add authentication, rate limiting, audit logging

---

## Sources

1. VS Code MCP Configuration Reference — https://code.visualstudio.com/docs/copilot/reference/mcp-configuration (Official, Weight: 1.0)
2. VS Code MCP Server Management — https://code.visualstudio.com/docs/copilot/customization/mcp-servers (Official, Weight: 1.0)
3. MCP Specification — https://modelcontextprotocol.io/specification/2025-03-26 (Official, Weight: 1.0)
4. MCP Security Best Practices — https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices (Official, Weight: 1.0)
5. GitHub MCP Server — https://github.com/github/github-mcp-server (Official, Weight: 1.0)
6. MCP Registry — https://github.com/modelcontextprotocol/registry (Official, Weight: 1.0)
7. MCP Example Remote Server — https://github.com/modelcontextprotocol/example-remote-server (Official, Weight: 1.0)
8. @modelcontextprotocol/sdk npm — https://www.npmjs.com/package/@modelcontextprotocol/sdk (Official, Weight: 1.0)
9. MCP Badge Creator — https://github.com/jamesmontemagno/mcp-badge-creator (Community, Weight: 0.7)
10. vscodemcp.com — https://vscodemcp.com/ (Community, Weight: 0.7)
11. Docker MCP Toolkit — https://www.docker.com/blog/mcp-server-best-practices/ (Official, Weight: 0.9)
12. Zuplo MCP Report — https://zuplo.com/mcp-report (Report, Weight: 0.8)
13. SlowMist MCP Security Checklist — https://github.com/slowmist/MCP-Security-Checklist (Community, Weight: 0.7)
14. MCP Health Checks Guide — https://fast.io/resources/implementing-mcp-server-health-checks/ (Blog, Weight: 0.6)
15. Publish MCP to npm — https://www.aihero.dev/publish-your-mcp-server-to-npm (Blog, Weight: 0.6)
16. MCP Server Security Report 2026 — https://dev.to/ecap0/the-state-of-mcp-server-security-in-2026-118-findings-across-68-packages-4fkd (Blog, Weight: 0.5)
