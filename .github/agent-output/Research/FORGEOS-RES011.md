# FORGEOS-RES011 — Web Framework and ORM Evaluation

**Agent:** Research Analyst  
**Stage:** RESEARCH  
**Date:** 2026-03-07T13:00:00+00:00  
**Confidence:** HIGH (88%)  
**Ticket Type:** research  
**SDLC Flow:** READY → RESEARCH → DOCS → VALIDATION → DONE  

---

## Executive Summary

Evaluated three Python web frameworks (FastAPI, Flask, Litestar) and two database access approaches (SQLAlchemy async, asyncpg raw) for a ForgeOS Python MCP server.

## Recommendations

| Category | Recommendation | Confidence | Decisive Factor |
|----------|---------------|------------|-----------------|
| **Web Framework** | **FastAPI** | 88% (HIGH) | Native Starlette alignment with MCP Python SDK — zero-adapter ASGI composition |
| **Database Access** | **SQLAlchemy async + asyncpg driver** | 85% (HIGH) | Alembic migration tooling + hybrid query approach (ORM + `text()` for stored functions) |
| **ASGI Server** | **Uvicorn** | 85% | Default for both FastAPI and MCP SDK |
| **Migration Tool** | **Alembic** | 92% | Auto-generated migrations with async engine support |

## Framework Weighted Scores

| Framework | Weighted Score | Rank |
|-----------|---------------|------|
| FastAPI | 9.30 / 10 | #1 |
| Litestar | 8.00 / 10 | #2 |
| Flask | 4.75 / 10 | #3 |

## ORM/DB Weighted Scores

| Approach | Weighted Score | Rank |
|----------|---------------|------|
| SQLAlchemy async | 8.73 / 10 | #1 |
| asyncpg raw | 6.95 / 10 | #2 |

## Key Findings

1. **MCP SDK Alignment (decisive):** MCP Python SDK uses Starlette internally. FastAPI is built on Starlette. This enables `app.mount("/mcp", mcp.streamable_http_app())` — native ASGI composition with no adapter overhead.
2. **Flask disqualified:** WSGI-native with async-via-threading bolt-on. Cannot natively mount MCP SDK's Starlette ASGI app. Fundamental architecture mismatch for async MCP server.
3. **Litestar viable but suboptimal:** 20-25% faster routing (immaterial for I/O-bound workload), but smaller ecosystem (6.2K vs 82K stars) and manual ASGI mounting for MCP SDK.
4. **SQLAlchemy uses asyncpg:** SQLAlchemy async uses asyncpg as its default PostgreSQL driver. Choosing SQLAlchemy does NOT sacrifice asyncpg performance — `text()` provides near-raw throughput for stored function calls.
5. **Alembic is decisive for DB access:** Auto-generated migrations, branching/merging, downgrade scripts. The alternative (manual SQL files) doesn't scale.

## Bayesian Update

- **Prior:** 70% — FastAPI + SQLAlchemy likely optimal
- **Posterior:** 88% — MCP SDK Starlette alignment is a decisive architectural advantage
- **Delta:** +18%

## Artifacts

- [docs/research/framework-evaluation.md](docs/research/framework-evaluation.md) — Full research report (weighted comparison matrices, contradiction analysis, risk assessment, license verification, repo health scores)

## Risks

1. FastAPI still 0.x version (mitigated: 7 years of production stability, versioning philosophy)
2. SQLAlchemy key-person risk — Mike Bayer (mitigated: 20-year track record, 700+ contributors)
3. Alembic cannot auto-generate stored function migrations (mitigated: raw SQL within Alembic files)

## Acceptance Criteria Coverage

| Criterion | Met | Evidence |
|-----------|-----|----------|
| FastAPI evaluated: async native, Pydantic validation, automatic OpenAPI, dependency injection | ✅ | Sections 5.2-5.6 |
| Flask evaluated: maturity, extension ecosystem, async limitations, community size | ✅ | Sections 6.2-6.6 |
| Litestar evaluated: performance, async native, validation, comparison with FastAPI | ✅ | Sections 7.2-7.7 |
| SQLAlchemy async evaluated: ORM features, migration integration (Alembic), query builder flexibility | ✅ | Sections 9.2-9.5 |
| asyncpg raw evaluated: performance, control, maintenance burden of raw SQL | ✅ | Sections 10.2-10.5 |
| Framework recommendation with justification | ✅ | Section 13.1 |
| ORM recommendation with justification | ✅ | Section 13.2 |
| Research report at docs/research/framework-evaluation.md | ✅ | File created |

## Validity Window

6 months (until 2026-09-07). Refresh triggers: FastAPI 1.0 release, MCP Python SDK v2.0 release, Litestar 3.0 release, major SQLAlchemy version bump.

## Next Stage

DOCS — Documentation Specialist should review and integrate findings into project documentation.
