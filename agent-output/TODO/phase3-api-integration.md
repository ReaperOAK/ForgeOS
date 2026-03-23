# TODO Agent Output — Phase 3 L2→L3 Decomposition

**Ticket:** Phase 3 — API & Integration
**Agent:** TODO (Execution Planning Mode)
**Timestamp:** 2026-03-05T20:00:00Z

## Summary

Decomposed 9 L2 execution blocks from Phase 3 (API & Integration) into 40 L3 actionable tickets (FORGEOS-BE028 through FORGEOS-BE067).

## Decomposition Tree

```
Phase 3 — API & Integration
├── BLK-06-01: MCP Tool Operations → 6 tickets (BE028–BE033)
├── BLK-06-02: REST API Endpoints → 5 tickets (BE034–BE038)
├── BLK-06-03: Real-time Streaming → 4 tickets (BE039–BE042)
├── BLK-07-01: Agent SDK Core → 4 tickets (BE043–BE046)
├── BLK-07-02: SDK Extensions → 4 tickets (BE047–BE050)
├── BLK-08-01: Identity & Auth → 4 tickets (BE051–BE054)
├── BLK-08-02: Authorization & Audit → 4 tickets (BE055–BE058)
├── BLK-09-01: Inbound Webhooks → 5 tickets (BE059–BE063)
└── BLK-09-02: Outbound Notifications → 4 tickets (BE064–BE067)
```

## Dependency Graph Summary

### Phase 2 → Phase 3 Dependencies
- BE020 (Tool Registration) → BE028 (tickets.next)
- BE006 (SKIP LOCKED) → BE028 (tickets.next)
- BE015 (MCP Server) → BE043 (SDK), BE051 (Agent Auth)
- BE002 (Core Tables) → BE051 (Agent Auth)
- BE012 (Event Sourcing) → BE030, BE035, BE039, BE058, BE064
- BE017 (SSE/HTTP Transport) → BE034, BE043, BE054, BE059
- BE008 (Heartbeat) → BE047 (SDK Heartbeat)
- BE013 (Repo DAL) → BE033 (tickets.sync)

### Intra-Phase 3 Dependency Chains
- BE028 → BE029, BE030, BE031, BE032, BE033 (MCP tools chain)
- BE028 → BE034 → BE035, BE036, BE037, BE038 (REST endpoints)
- BE034 → BE039 → BE040 (WebSocket streaming)
- BE043 → BE044 → BE045 → BE047, BE048, BE049 → BE050 (SDK chain)
- BE051 → BE052, BE053, BE054 → BE055, BE056, BE057, BE058 (Auth chain)
- BE059 → BE060 → BE061, BE062, BE063 (Webhooks chain)
- BE064 → BE065, BE066, BE067 (Notifications chain)

## Artifact Paths

- `TODO/tasks/phase3-ticket-api.md` — 15 tickets (BLK-06-01, BLK-06-02, BLK-06-03)
- `TODO/tasks/phase3-agent-sdk.md` — 8 tickets (BLK-07-01, BLK-07-02)
- `TODO/tasks/phase3-auth.md` — 8 tickets (BLK-08-01, BLK-08-02)
- `TODO/tasks/phase3-webhooks.md` — 9 tickets (BLK-09-01, BLK-09-02)
- `.github/tickets/FORGEOS-BE028.json` through `.github/tickets/FORGEOS-BE067.json` (40 JSON files)

## Evidence

- **Total L3 tickets generated:** 40
- **Ticket JSON files created by --parse:** 40
- **Integrity check:** PASSED
- **All tickets have:** type=backend, testable acceptance criteria, file_paths, dependencies
- **Confidence level:** HIGH — All blocks have clear scope from L2, dependency mappings verified against actual Phase 2 ticket JSONs, file paths consistent with existing project structure (mcp-server/src/, agent-sdk/src/, database/alembic/)
