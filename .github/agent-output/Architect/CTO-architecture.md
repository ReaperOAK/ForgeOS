# Architect Summary — CTO-architecture

**Agent:** Architect  
**Date:** 2026-03-23T12:00:00Z  
**Ticket:** CTO-architecture  
**Stage:** ARCHITECT  

---

## What Was Done

Designed the full architecture for making ForgeOS MCP Server a standalone, production-ready, distributable MCP server. Produced a comprehensive architecture document at `docs/architecture/MCP-STANDALONE-ARCH.md` with:

### Architecture Decisions (5 ADRs)

1. **ADR-DIST-001**: Docker Compose as primary distribution (vs npm/Helm) — single `docker compose up` starts PG + Ollama + MCP server
2. **ADR-DIST-002**: PostgreSQL SKIP LOCKED worker for durable compile queue — zero new dependencies, uses existing migration 009 table
3. **ADR-DIST-003**: PostgreSQL trigger function for multi-stage compile triggers — fires on READY/BACKEND/FRONTEND stage transitions
4. **ADR-DIST-004**: Build-time bundled agent definitions with DB-first lookup — enables standalone distribution without `.github/` directory
5. **ADR-DIST-005**: 5-phase ordered graceful shutdown — SSE → worker → HTTP → resources → exit

### Key Design Components

| Component | File | Pattern |
|-----------|------|---------|
| Compile Worker | `src/services/compile-worker.ts` | SKIP LOCKED polling loop, exponential backoff retry, dead-letter |
| Compile Triggers | `src/db/migrations/011-compile-triggers.sql` | PG trigger on `tickets.stage` column updates |
| Agent Def Seeding | `src/db/seed-agent-definitions.ts` | Bundled JSON fallback, embedding generation via Ollama |
| Graceful Shutdown | `src/index.ts` | 5-phase: signal → SSE drain → worker stop → HTTP drain → pool close |
| Standalone Stack | `docker-compose.standalone.yml` | PG 17 + pgvector, Ollama + model init, MCP server, auto-migrate |
| VS Code Install | `.vscode/mcp.json` | HTTP transport config with `${input:}` variable prompts |

### Implementation Sequence

- **Phase 1** (parallel): compile-worker, PG trigger migration, agent-def bundler, mcp.json
- **Phase 2** (parallel): enhanced seeding, config fields, queue helpers
- **Phase 3** (sequential): index.ts startup integration, shutdown enhancement
- **Phase 4** (sequential): standalone docker-compose, Dockerfile labels, README badges

### No Schema Changes Beyond One Migration

Only `011-compile-triggers.sql` is new. All other tables exist (migrations 009, 010).

### No MCP Tool API Changes

All 22 tools remain unchanged. Changes are infrastructure-layer only.

---

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| Docker Compose over pure npm | ForgeOS needs PG + Ollama — can't bundle in npx |
| SKIP LOCKED over Redis/BullMQ | Zero new dependencies; PG already required |
| PG trigger over app-level hooks | Cannot be bypassed by application bugs |
| Bundled JSON over filesystem-only | Standalone Docker image has no `.github/` dir |
| 30s hard shutdown timeout | Current 10s too aggressive for compile jobs |

## Artifacts

- [docs/architecture/MCP-STANDALONE-ARCH.md](../../docs/architecture/MCP-STANDALONE-ARCH.md) — Full architecture document

## Confidence

**HIGH** — All designs leverage existing infrastructure (PG, Ollama, Express) with proven patterns (SKIP LOCKED, PG triggers, Docker Compose). No new external dependencies.
