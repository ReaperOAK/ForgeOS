# FORGEOS-RES009 — Research Stage Summary

> **Agent:** Research Analyst  
> **Stage:** RESEARCH  
> **Ticket:** FORGEOS-RES009  
> **Date:** 2026-03-05  
> **Confidence:** HIGH (88%)

---

## Research Question

Perform a detailed gap analysis of the current ForgeOS file-based system (`tickets.py`, `agent-runner.py`, `todo_visual.py`) against the distributed platform requirements (`forgeos-server/` with PostgreSQL + MCP). Map every current capability to its distributed equivalent. Identify gaps, risks, and migration complexity.

## Key Findings

### Capability Coverage
- **32 capabilities** inventoried across three source files
- **28 of 32** have direct or enhanced equivalents in the distributed platform
- **4 gaps** identified (L3 markdown parser, DOT graph format, git two-commit protocol, terminal dashboard)
- **11 new capabilities** in distributed platform with no predecessor

### Critical Gaps
1. **L3 Markdown Parser** — `parse_l3_tasks()` has no distributed equivalent. `tickets.spawn` creates individual tickets but cannot batch-parse L3 markdown. Blocking gap for TODO agent.
2. **Two-Commit Protocol** — `agent-runner.py`'s core purpose (git push = distributed lock) is replaced by `SELECT FOR UPDATE SKIP LOCKED` in PostgreSQL. Fundamental protocol change affecting all 14 agents and 6 instruction files.
3. **Summary Handoff Chain** — File-based `.github/agent-output/{Agent}/{ticket-id}.md` partially covered by ticket `metadata` JSONB. Decision needed: hybrid vs full migration.

### New Capabilities (No Predecessor)
- File-level mutex (`file_locks` table)
- Real-time SSE events (`pg_notify` trigger)
- Agent authentication with API keys
- Session management
- Multi-project support
- Event sourcing audit trail
- Row-Level Security
- Lease extension
- Structured error codes
- System configuration table
- Ticket metadata JSONB

### Migration Strategy
- **Phase 1** (Week 1-2): Deploy PostgreSQL + MCP server, build L3 parser MCP tool, import existing tickets
- **Phase 2** (Week 2-3): Dual-mode operation — agents use MCP for ticket ops, git for code delivery
- **Phase 3** (Week 3-4): Remove file-based state, update agent definitions, decommission tickets.py/agent-runner.py
- **Phase 4** (Week 4+): Enable file mutex, SSE, auth, multi-project

### Risk Summary
| Risk | Severity | Mitigation |
|------|----------|-----------|
| Two-commit protocol removal | Critical | Migration shim + phased agent updates |
| L3 parser gap | High | Build `tickets.parse` MCP tool |
| State directory removal | Medium | Search all references, build compat layer |
| Terminal dashboard loss | Low | Optional MCP client CLI |

## Artifacts

- **Full Report:** `docs/research/system-gap-analysis.md`
  - Section 1-3: Complete capability inventories (tickets.py: 14 functions + 9 helpers, agent-runner.py: 8 functions, todo_visual.py: 15 functions)
  - Section 4: Gap matrix with 38 capability mappings (gap severity + migration complexity per item)
  - Section 5: 11 new distributed capabilities documented
  - Section 6: Risk assessment with 8 risk items rated
  - Section 7: Migration complexity ratings per component
  - Section 8: Recommended 4-phase migration strategy
  - Section 9: Schema comparison (30+ field mappings between file-based and DB)
  - Section 10: Bayesian confidence assessment (prior 70% → posterior 88%)
  - Appendix A: Function cross-reference table
  - Appendix B: Event type mapping (7 existing → 13 in distributed platform)

## Bayesian Update
- **Prior:** 70% confidence (expected clean mapping, suspected git protocol gaps)
- **Posterior:** 88% confidence (SQL functions closely mirror Python functions; risks well-understood)
- **Delta:** +18% — Evidence showed cleaner mapping than expected. Critical risk is protocol-level (git → DB), not capability loss.

## Downstream Notes for DOCS Agent
- The full report at `docs/research/system-gap-analysis.md` is the primary deliverable
- Focus documentation on the migration strategy (Section 8) and gap matrix (Section 4)
- The schema comparison (Section 9) should be referenced in any migration guide
- The function cross-reference (Appendix A) is useful for developer reference
