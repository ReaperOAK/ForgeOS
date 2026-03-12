# Architect Summary — CTO-architecture

> **Agent:** Architect  
> **Ticket:** CTO-architecture  
> **Stage:** ARCHITECT  
> **Confidence:** HIGH (95%)  
> **Timestamp:** 2026-03-12T16:30:00Z

---

## Verdict

**PASS** — Full architecture fix plan produced covering all 10 areas.

## Upstream Inputs

- **Research Analyst** (`CTO-research.md`): 15 issues identified, 6 critical blockers
- **PRD** (`PRD-mcp-operational.md`): 12 success criteria, P0-P2 feature set, TypeScript MCP server as primary target

## Context Map

### Primary Files (directly modified by fixes)
| File | Fix(es) |
|------|---------|
| `forgeos-server/tsconfig.json` | Fix 1 — CREATE |
| `forgeos-server/src/server.ts` | Fix 2, Fix 3 |
| `forgeos-server/src/middleware/auth.ts` | Fix 3 |
| `forgeos-server/src/index.ts` | Fix 4 |
| `forgeos-server/src/db/seed.ts` | Fix 4 |
| `forgeos-server/src/db/migrate.ts` | Fix 7 |
| `forgeos-server/src/db/migrations/001_initial.sql` | Fix 5 |
| `forgeos-server/src/db/migrations/002_add_event_types.notx.sql` | Fix 7 — CREATE |
| `forgeos-server/src/tools/index.ts` | Fix 6 |
| `forgeos-server/src/tools/tickets-reject.ts` | Fix 6 |
| `forgeos-server/src/tools/tickets-update.ts` | Fix 6 |
| `infra/docker-compose.yml` | Fix 5, Fix 8 |
| `infra/docker-compose.dev.yml` | Fix 5, Fix 8 |
| `infra/secrets/db_password` | Fix 8 — CREATE |
| `infra/.env.example` | Fix 8 — CREATE |
| `forgeos-server/src/db/seed-demo.ts` | Fix 9 — CREATE |
| `forgeos-server/scripts/smoke-test.sh` | Fix 10 — CREATE |

### Secondary Files (affected but not directly modified)
- `forgeos-server/src/types/index.ts` — EventType enum (source of truth for Fix 7)
- `forgeos-server/src/middleware/index.ts` — barrel exports (already correct)
- `forgeos-server/src/api/index.ts` — API router (already implemented, just needs mounting)
- `forgeos-server/src/auth/keys.ts` — admin key fallback (Fix 4)
- `forgeos-server/.env.example` — already exists

### Established Patterns
- Zod schema per tool → export handler function → register in `tools/index.ts`
- ON CONFLICT DO NOTHING/UPDATE for idempotent seed
- SHA-256 checksum tracking in `schema_migrations`
- `PUBLIC_PATH_PREFIXES` for auth exemptions

## Artifacts

| File | Type | Description |
|------|------|-------------|
| `docs/architecture/fix-plan.md` | Architecture Plan | 10-fix design with exact code, DAG, Well-Architected assessment |

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| TypeScript as canonical MCP server | Python server has incompatible schema; maintaining both doubles engineering cost |
| Remove `initdb.d` mount (don't fix SQL) | App migration runner has proper tracking; Docker raw SQL execution has none |
| Admin API key bootstrap over `/mcp` exemption | Auth-exempt MCP endpoint is a security risk; admin key is already in config |
| `.notx.` suffix for non-transactional migrations | More explicit than SQL parsing; self-documenting filename convention |
| `agent_name` as schema parameter in `tickets.reject` | Matches existing pattern in `tickets.release`; consistent API surface |
| Single `StreamableHTTPServerTransport` instance | Per-request instances leak memory and cause race conditions on `mcpServer.connect()` |

## Implementation DAG

**Critical Path:** Fix 1 → Fix 8 → Fix 3 → Fix 10

**Parallelization Groups:**
- G1: Fix 1 (tsconfig) — independent
- G2: Fix 5 (migration idempotency) — independent
- G3: Fix 8A (secrets) — independent
- G4: Fix 2 (MCP transport) — independent
- G5: Fix 3 + Fix 4 (middleware + auth) — depends on G4
- G6: Fix 6 + Fix 7 + Fix 9 (tools + enum + seed) — depends on all Phase 1
- G7: Fix 8B (Docker compose URLs) — depends on G1, G3
- G8: Fix 10 (smoke test) — depends on all

## Anti-Pattern Flags

- **Distributed Monolith:** Two servers (TS + Python) with different schemas → ADR: deprecate Python server
- **Shared Database risk:** Both servers would compete on same PostgreSQL → resolved by server consolidation

## Well-Architected Scores

| Pillar | Score |
|--------|:---:|
| Operational Excellence | 7/10 |
| Security | 6/10 |
| Reliability | 7/10 |
| Performance | 8/10 |
| Cost Optimization | 9/10 |
| Sustainability | 7/10 |

## Downstream Instructions

The TODO agent should decompose this fix plan into 8-10 tickets following the DAG ordering. Each fix maps to 1-2 tickets. Fix 3 and Fix 4 should be a single ticket (both modify `server.ts` and `index.ts`). Fix 10 depends on all others and should be the last ticket.

**Express version note:** The PRD states Express ^5.1.0, but `package.json` shows `^4.21.2`. The fix plan is designed for Express 4.x. If upgrading to Express 5 is desired, that should be a separate ticket with its own scope.
