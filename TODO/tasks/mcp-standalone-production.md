# MCP Standalone Production Readiness (L3 Tickets)

Source: CTO Session — MCP Standalone Implementation & Debugging
Date: 2026-03-23

---

# TASK-MCP-BE001: Fix Compile Worker Packet Validation

**Type:** backend
**Priority:** high
**Dependencies:**
**Files:** forgeos-server/src/services/compiler.ts, forgeos-server/src/services/packet-validator.ts, forgeos-server/src/services/compile-orchestrator.ts
**Tags:** mcp-standalone, compile-worker, llm, production

## Description

The compile worker processes queue jobs end-to-end but the LLM output (Ollama qwen2.5:7b-instruct) doesn't pass the 11-section packet validation. The error is "Packet validation failed. Packet structure is invalid." The prompt template needs to be improved to reliably produce all 11 required sections in the correct order: ROLE, TICKET, SYSTEM CONSTRAINTS, HISTORY, LEARNINGS, BEST PRACTICES, CONTEXT LOCATIONS, YOUR EXACT TASK, EXECUTION PLAN, EDGE CASES, POST-COMPLETION.

## Acceptance Criteria

- [ ] Prompt template includes explicit section headers in the required format
- [ ] Few-shot example included in system prompt showing valid packet structure
- [ ] LLM output passes `validatePacketSections()` on ≥90% of compile attempts
- [ ] Compile worker successfully stores compiled prompts in the tickets table
- [ ] Fallback: if validation fails after 3 retries, store raw output with warning flag
- [ ] Add integration test for compile pipeline with mock LLM response

---

# TASK-MCP-BE002: Publish Docker Image to GHCR

**Type:** backend
**Priority:** high
**Dependencies:**
**Files:** forgeos-server/Dockerfile, .github/workflows/publish-docker.yml
**Tags:** mcp-standalone, distribution, docker, ci

## Description

Publish the ForgeOS MCP Server Docker image to GitHub Container Registry (ghcr.io) so users can run the standalone compose without building from source. Create a GitHub Actions workflow that builds and pushes on tag/release.

## Acceptance Criteria

- [ ] GitHub Actions workflow builds multi-arch image (amd64 + arm64)
- [ ] Image published to ghcr.io/reaperoak/forgeos-mcp-server:latest and :version
- [ ] docker-compose.standalone.yml updated to reference ghcr.io image instead of local build
- [ ] Image size optimized (multi-stage build, no dev deps)
- [ ] Workflow triggers on version tags (v*) and releases
- [ ] README updated with ghcr.io pull instructions

---

# TASK-MCP-BE003: Create npm Package for stdio Transport

**Type:** backend
**Priority:** medium
**Dependencies:** TASK-MCP-BE002
**Files:** forgeos-server/package.json, forgeos-server/src/stdio-transport.ts, forgeos-server/bin/forgeos-mcp.js
**Tags:** mcp-standalone, distribution, npm, stdio

## Description

Create an npm package (@forgeos/mcp-server) that can be run via npx for users who prefer stdio transport over HTTP. This enables `npx @forgeos/mcp-server` as a zero-install option for VS Code users who don't need the full Docker stack.

## Acceptance Criteria

- [ ] Package publishable as @forgeos/mcp-server on npm
- [ ] `npx @forgeos/mcp-server` starts server in stdio mode
- [ ] `npx @forgeos/mcp-server --http` starts server in HTTP mode
- [ ] Requires DATABASE_URL env var (PostgreSQL must be provided separately)
- [ ] README includes stdio-mode VS Code configuration
- [ ] One-click badge updated with npx variant

---

# TASK-MCP-BE004: Production Security Hardening

**Type:** backend
**Priority:** high
**Dependencies:**
**Files:** forgeos-server/src/middleware/auth.ts, forgeos-server/src/config.ts, forgeos-server/docker-compose.standalone.yml
**Tags:** mcp-standalone, security, production

## Description

Harden the MCP server for production deployment. Currently uses a default admin key that must be changed. Implement secure defaults, rate limiting improvements, and CORS configuration.

## Acceptance Criteria

- [ ] Server refuses to start in production mode with default ADMIN_API_KEY
- [ ] First-boot generates a random admin key and prints it once to stdout
- [ ] API keys use bcrypt hashing instead of SHA-256
- [ ] CORS origins configurable via ALLOWED_ORIGINS env var
- [ ] Rate limiter uses sliding window per API key (not per IP)
- [ ] Health and ready endpoints remain public, all others require auth
- [ ] Secrets directory (.secrets/) in standalone compose uses Docker secrets

---

# TASK-MCP-BE005: MCP Registry Submission

**Type:** backend
**Priority:** medium
**Dependencies:** TASK-MCP-BE002, TASK-MCP-BE003
**Files:** forgeos-server/mcp-registry.json, README.md
**Tags:** mcp-standalone, distribution, registry

## Description

Submit ForgeOS MCP Server to the official MCP Registry (registry.modelcontextprotocol.io) and community directories (awesome-mcp-servers, Smithery.ai, Glama.ai). This increases discoverability for the MCP ecosystem.

## Acceptance Criteria

- [ ] mcp-registry.json manifest created per official spec
- [ ] Submission PR to official MCP Registry repository
- [ ] Listed on at least 2 community directories
- [ ] Server metadata endpoint returns tool descriptions for registry crawlers
- [ ] README includes registry badges once listed

---

# TASK-MCP-FE001: Dashboard Live Kanban Improvements

**Type:** frontend
**Priority:** low
**Dependencies:**
**Files:** forgeos-server/src/dashboard/
**Tags:** mcp-standalone, dashboard, ux

## Description

Improve the live Kanban dashboard with better UX: ticket detail modal, filter persistence, dark mode support, and mobile-responsive layout.

## Acceptance Criteria

- [ ] Clicking a ticket card opens detail modal with full metadata
- [ ] Stage filters persist across page reloads (URL params or localStorage)
- [ ] Dark mode toggle with system preference detection
- [ ] Responsive layout works on tablet and mobile screens
- [ ] SSE reconnection with exponential backoff on disconnect
- [ ] Loading skeleton while initial snapshot arrives

---

# TASK-MCP-QA001: Comprehensive Integration Test Suite

**Type:** fullstack
**Priority:** high
**Dependencies:** TASK-MCP-BE001
**Files:** forgeos-server/src/__tests__/
**Tags:** mcp-standalone, testing, qa

## Description

Create a comprehensive integration test suite that exercises all 22 MCP tools through the Streamable HTTP transport. Tests should use a real PostgreSQL database (via testcontainers or Docker) and verify the full lifecycle.

## Acceptance Criteria

- [ ] Test suite covers all 22 MCP tools
- [ ] Full lifecycle test: claim → extend → update → spawn → complete → release
- [ ] Rejection and rework cycle test
- [ ] Concurrent claim conflict test (two agents claim same ticket)
- [ ] File lock conflict detection test
- [ ] Memory store/recall round-trip test
- [ ] Code search/locate/explain tests with sample codebase
- [ ] Tests run in CI via `npm test` with Docker Compose test stack
- [ ] Coverage ≥80% for tool handlers
