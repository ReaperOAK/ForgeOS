# TASK-INT-BE009 — Backend Complete

## Summary

Rewrote 6 review and dispatch agent files for MCP-native operations, replacing all `tickets.py` CLI calls and `ticket-state/` directory-based state management with ForgeOS MCP Server tool contracts.

## Files Modified

| File | Sections Changed | Key Changes |
|------|-----------------|-------------|
| `.github/agents/QA.agent.md` | §3 Boot (step 6), §4 Pre-Claimed, §6 Verdict, §7 Work Commit | `tickets.payload`, `tickets.complete`/`tickets.reject` with evidence payloads |
| `.github/agents/Security.agent.md` | §3 Boot (step 6), §4 Pre-Claimed, §6 Verdict, §7 Work Commit | Same MCP pattern; STRIDE/OWASP/CWE evidence in reject payloads |
| `.github/agents/CIReviewer.agent.md` | §3 Boot (step 6), §4 Pre-Claimed, §6 Verdict (PASS/FAIL), §7 Work Commit | `tickets.complete` with SARIF evidence, `tickets.reject` with lint/complexity reasons |
| `.github/agents/Documentation.agent.md` | §3 Boot (step 6), §4 Pre-Claimed, §6 Work Commit (item 3) | `tickets.complete` with doc coverage evidence |
| `.github/agents/Validator.agent.md` | §2 Stage, §3 Boot (step 6), §4 Pre-Claimed, §6 Verdict, §7 Work Commit | `tickets.complete`/`tickets.reject` with DoD checklist evidence |
| `.github/agents/Ticketer.agent.md` | Frontmatter, Title, Role, Tools, SOP, §2 Boot, §3 Execution Loop, §4 Delegation, §8 Prohibited, §9 Parallelism, §10 Rework, §11 References (14 sections) | Full rewrite: ForgeOS orchestrator identity, `tickets.list`→`tickets.claim`→dispatch→`tickets.complete` loop |

## Acceptance Criteria Verification

| AC | Status | Evidence |
|----|--------|----------|
| 1. Rewrite 6 agent files for MCP operations | ✅ | All 6 files updated with 22 successful replacements |
| 2. QA/Security/Validator use `tickets.reject` for rework | ✅ | Each has 2+ `tickets.reject` references with structured evidence payloads |
| 3. Ticketer becomes ForgeOS orchestrator loop caller | ✅ | Title, role, execution loop all rewritten for MCP `tickets.list`→`tickets.claim` |
| 4. Boot sequences use `tickets.payload(ticket_id)` | ✅ | All 6 files reference `tickets.payload` (2+ per file) |
| 5. All `ticket-state/` directory references removed | ✅ | `grep -n 'ticket-state/' *.agent.md` → 0 matches |
| 6. Tool loadouts preserved unchanged | ✅ | All Assigned Tool Loadout sections untouched |
| 7. Review agents reference MCP evidence payloads | ✅ | All review agents include jsonc evidence examples with `artifacts`, `test_results`, `confidence` |

## Verification

```bash
# Zero remaining old-system references across all 6 files
$ grep -c 'tickets\.py\|ticket-state/' .github/agents/{QA,Security,CIReviewer,Documentation,Validator,Ticketer}.agent.md
# All returned 0
```

## TDD Evidence

This ticket modifies markdown documentation files (agent behavioral specifications), not executable code. TDD is N/A — validation was performed via grep verification confirming complete removal of old references and presence of new MCP tool references.

## Confidence

**HIGH** — All 7 acceptance criteria verified. Zero old-system references remain. All MCP tool contracts follow the patterns established in `core.instructions.md` and `ticket-system.instructions.md`.

## Timestamp

2026-03-12T22:00:00Z
