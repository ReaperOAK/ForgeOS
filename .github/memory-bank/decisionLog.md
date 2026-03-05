---
id: decision-log
version: "1.0"
owner: ReaperOAK
write_access: [ReaperOAK]
append_only: true
immutable_to_subagents: true
---

# Decision Log

> **Schema Version:** 1.0
> **Owner:** ReaperOAK (EXCLUSIVE)
> **Write Access:** ReaperOAK ONLY — this file is IMMUTABLE to all subagents
> **Lock Rules:** No subagent may modify, delete, or overwrite any entry.
> Subagents may propose decisions via `activeContext.md` but only ReaperOAK
> records them here.
> **Update Protocol:** Append-only. Each entry requires: date, context,
> decision, rationale, alternatives considered, and consequences.

---

## Decision Record Format

```
### DEC-{number}: {title}
- **Date:** YYYY-MM-DD
- **Context:** What prompted this decision
- **Decision:** What was decided
- **Rationale:** Why this was chosen
- **Alternatives:** What else was considered
- **Consequences:** Expected impact
- **Status:** Active | Superseded by DEC-{number}
```

---

## Decisions

### DEC-001: Adopt Supervisor Pattern with ReaperOAK as Singular Orchestrator

- **Date:** 2026-02-21
- **Context:** Repository has 3 competing orchestration patterns (GEM, RUG,
  Edge-AI) with no unified authority
- **Decision:** ReaperOAK serves as the exclusive supervisor. All subagents
  report to ReaperOAK. No peer-to-peer agent communication.
- **Rationale:** Single source of truth prevents authority fragmentation,
  context degradation, and conflicting directives. Mirrors proven enterprise
  supervisor patterns.
- **Alternatives:** Peer-to-peer mesh (rejected: coordination overhead),
  hierarchical chain (rejected: latency multiplication)
- **Consequences:** All delegation flows through ReaperOAK; slight bottleneck
  at orchestrator but gains determinism and auditability
- **Status:** Active

### DEC-002: Memory Bank Files Are Git-Tracked Markdown

- **Date:** 2026-02-21
- **Context:** Need persistent state across agent sessions without external
  database dependencies
- **Decision:** Use `.github/memory-bank/*.md` files tracked in Git
- **Rationale:** Human-readable, version-controlled, no infrastructure cost,
  works with any agent framework
- **Alternatives:** Vector DB (rejected: external dependency), SQLite
  (rejected: not human-readable), Redis (rejected: ephemeral)
- **Consequences:** State limited to text; no complex queries. Acceptable for
  coordination metadata.
- **Status:** Active

### DEC-003: Subagents Cannot Modify systemPatterns or decisionLog

- **Date:** 2026-02-21
- **Context:** Risk of memory poisoning if any subagent can overwrite
  architectural truth
- **Decision:** Only ReaperOAK may write to `systemPatterns.md` and
  `decisionLog.md`. All other agents have read-only access.
- **Rationale:** Prevents cascading corruption if a subagent hallucinates or
  is compromised. Ensures architectural consistency.
- **Alternatives:** Subagent proposals with approval gate (rejected:
  complexity; proposals happen via activeContext.md instead)
- **Consequences:** Subagents must propose changes through activeContext.md
  and wait for ReaperOAK to formalize them
- **Status:** Active

### DEC-004: Maximum 4 Parallel Subagents

- **Date:** 2026-02-21
- **Context:** Need to balance throughput with coordination overhead and
  context window management
- **Decision:** Cap at 4 concurrent subagents per parallel batch
- **Rationale:** Empirical research shows 40-50% coordination overhead in
  multi-agent systems. 4 agents balances parallelism with manageable merge
  complexity.
- **Alternatives:** Unlimited (rejected: merge chaos), 2 (rejected: too
  conservative)
- **Consequences:** Large tasks may require multiple sequential parallel
  batches
- **Status:** Active

### DEC-005: All CI/CD AI Workflows Are Read-Only by Default

- **Date:** 2026-02-21
- **Context:** Risk of AI agents auto-merging broken or malicious code
- **Decision:** AI workflows comment findings but never auto-merge. Human
  approval required for all write operations.
- **Rationale:** Prevents catastrophic automated deployments. Maintains human
  authority over production state.
- **Alternatives:** Auto-merge with confidence threshold (rejected: false
  positive risk)
- **Consequences:** Slightly slower merge cadence but dramatically safer
- **Status:** Active

### DEC-006: Dual-Agent Support (GitHub Copilot + Claude Code)

- **Date:** 2026-02-23
- **Context:** Vibecoding system was exclusively configured for GitHub Copilot.
  Need to support Claude Code as an alternative/complementary agent.
- **Decision:** Add Claude Code configuration alongside existing Copilot setup.
  Both agents share the same memory bank, instruction files, and governance
  principles. Each has its own configuration format: Copilot uses
  `.github/agents/*.agent.md`, Claude Code uses `CLAUDE.md` + `.claude/`.
- **Rationale:** Agent-agnostic design allows team members to use their preferred
  tool. Shared memory bank and instruction files ensure consistency regardless
  of which agent is active. No Copilot configs are modified.
- **Alternatives:** Replace Copilot with Claude Code (rejected: reduces
  flexibility), create separate instruction sets (rejected: maintenance burden
  and drift risk)
- **Consequences:** Must maintain two configuration surfaces (`.github/agents/`
  for Copilot, `.claude/` + `CLAUDE.md` for Claude Code). Instruction files in
  `docs/instructions/` and memory bank in `.github/memory-bank/` are shared by
  both. Log directories separated (`logs/copilot/` vs `logs/claude-code/`).
- **Status:** Active
