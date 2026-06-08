# Memory Bank Schema

The memory bank is ForgeOS's durable, file-based shared memory. Every file
carries YAML frontmatter declaring its `id`, `version`, `owner`,
`write_access`, and whether it is `append_only`.

| File | Purpose | Append-only |
|------|---------|-------------|
| `activeContext.md` | Per-ticket summaries (the memory gate) | yes |
| `progress.md` | Running log of completed work / milestones | yes |
| `decisionLog.md` | Architecture & strategic decisions (ADR-style) | yes |
| `riskRegister.md` | Identified risks + mitigations | yes |
| `feedback-log.md` | Human feedback & corrections | yes |
| `productContext.md` | Product vision, users, success metrics | no |
| `systemPatterns.md` | Recurring architecture/code patterns | no |
| `workflow-state.json` | Phase/task state machine snapshot | no |
| `artifacts-manifest.json` | Ticket → produced files + commit map | no |

**Rules**

- Respect `write_access`: only listed agents write a given file.
- Append-only files are never rewritten — only appended.
- The **memory gate**: an agent must append a `### [{ticket-id}] — Summary`
  entry to `activeContext.md` before a ticket may be marked DONE.
