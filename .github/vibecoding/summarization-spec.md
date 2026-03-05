---
id: summarization-spec
version: "1.0"
locked_by: ReaperOAK
---

# Summarization & Token Economy

## Session Summarizer Spec

### Purpose
Reduce token cost of long-running sessions by compacting verbose context into
dense summaries without losing critical decision chains.

### Trigger Conditions
- activeContext.md exceeds 50 entries
- Session token usage exceeds 60% of budget
- Memory bank total exceeds 20,000 estimated tokens
- Manual trigger via `update memory bank` command

### Summary Levels

| Level | Max Tokens | Use Case |
|-------|-----------|----------|
| summary_128 | 128 | Catalog references, chunk headers |
| summary_512 | 512 | Quick context reload, search results |
| summary_2048 | 2048 | Full session handoff, progress report |

### summary_128 Generation Rules
- REQUIRE: One sentence stating objective + outcome
- REQUIRE: Comma-separated list of key files touched
- DENY: Code snippets, full paths, or verbose explanations
- Example: "Implemented auth middleware (src/auth/*, tests/auth/*); all tests passing."

### summary_512 Generation Rules
- REQUIRE: Objective, approach, outcome, pending items
- ALLOW: Key file references, decision highlights
- DENY: Full code blocks, verbose rationale
- Example format:
  ```
  OBJECTIVE: [what was attempted]
  APPROACH: [how it was done]
  OUTCOME: [result with evidence]
  PENDING: [what remains]
  DECISIONS: [key trade-offs made]
  ```

### summary_2048 Generation Rules
- REQUIRE: Full context for session handoff
- INCLUDE: Objective, approach, all decisions, evidence, pending work, risks
- ALLOW: Short code references, file:line citations
- DENY: Duplicating full file contents

## Compaction Protocol

### activeContext.md Compaction
- Entries older than 50 items archived to `activeContext.archive.md`
- Archived entries replaced with summary_128 reference
- Only ReaperOAK may perform compaction
- Archive format: timestamped markdown with original entries verbatim

### decisionLog.md Compaction
- NEVER delete decision entries — append-only is absolute
- After 100 entries, create `decisionLog.index.md` with summary_128 per entry
- Index enables fast lookup without loading full log
- Full log remains source of truth

### progress.md Compaction
- Completed milestones older than 30 days may be archived
- Archive to `progress.archive.md`
- Keep last 10 milestones in active file regardless of age

## Token Budget Optimization

### Context Loading Priority
- P0 (30%): Active errors, delegation packet, systemPatterns
- P1 (25%): activeContext, relevant source files
- P2 (25%): decisionLog index, progress summary
- P3 (20%): Historical archives, completed tasks (load on demand)

### Chunk Preference Order
1. summary_128 from catalog.yml for initial discovery
2. summary_512 from chunk YAML headers for relevance assessment
3. Full chunk content only when editing or deep analysis needed
4. Original source file only when chunk boundaries are insufficient

### Cost Tracking
- Every agent logs token_input and token_output per tool call
- Cumulative tracked in claim file
- ReaperOAK monitors session-wide aggregate
- Reports generated at session end with per-agent breakdown
