# Git Integration Tickets

## TASK-FOS-06-001: Husky Commit-Msg Hook

**Type:** infra
**Priority:** medium
**Dependencies:**
**Files:** forgeos-server/.husky/commit-msg, forgeos-server/scripts/validate-commit.sh

### Description
Install Husky in the ForgeOS server project and create a commit-msg hook that validates commit message format as specified in Architecture §7.5. The hook reads the commit message from the file passed as $1, validates it matches the required [TICKET-ID] prefix pattern using regex. Valid formats: "[TICKET-ID] CLAIM by AGENT on MACHINE (OPERATOR)" for claim commits and "[TICKET-ID] STAGE complete by AGENT on MACHINE" for work commits. Invalid messages are rejected with a clear error message showing the expected format. The hook is a shell script committed to the .husky/ directory.

### Acceptance Criteria
- [ ] Husky installed as devDependency in package.json with "prepare": "husky" script
- [ ] .husky/commit-msg hook script is executable and committed to the repository
- [ ] Hook validates commit message matches regex: ^\[[A-Z0-9]+-[A-Z0-9]+-?[A-Z0-9]*\]
- [ ] Rejects non-matching messages with error showing expected CLAIM and WORK commit formats
- [ ] Accepts valid CLAIM format: [FORGEOS-001] CLAIM by Backend on machine-1 (operator)
- [ ] Accepts valid WORK format: [FORGEOS-001] BACKEND complete by Backend on machine-1
- [ ] --no-verify bypass works for emergency commits (standard Git behavior)
- [ ] Hook exits 0 on valid messages, exits 1 on invalid messages

---

## TASK-FOS-06-002: Husky Pre-Commit Hook — Blast Radius Validation

**Type:** infra
**Priority:** medium
**Dependencies:** TASK-FOS-06-001
**Files:** forgeos-server/.husky/pre-commit, forgeos-server/scripts/validate-scope.sh

### Description
Create a pre-commit hook that validates the blast radius of staged files against the ticket's declared file_paths scope as specified in Architecture §7.5 and PRD FR-20. The hook extracts the ticket ID from the most recent commit message (or from a FORGEOS_TICKET_ID environment variable), queries the MCP server's REST API (GET /api/tickets/:id) to get the ticket's file_paths, then checks each staged file against the allowed paths using prefix matching. Files outside the ticket's scope cause the commit to be rejected. If the MCP server is unreachable, the hook warns but allows the commit (graceful degradation).

### Acceptance Criteria
- [ ] .husky/pre-commit hook script is executable and committed to the repository
- [ ] Hook extracts ticket ID from FORGEOS_TICKET_ID env var or from last commit message pattern
- [ ] Hook queries FORGEOS_MCP_URL/api/tickets/{id} to get the ticket's file_paths
- [ ] Each staged file (git diff --cached --name-only) is checked against file_paths using prefix matching
- [ ] Out-of-scope files cause rejection with error listing the violating files and allowed paths
- [ ] If MCP server is unreachable (curl fails), hook prints WARNING and allows commit (exit 0)
- [ ] If no ticket context is available, hook allows commit with INFO message
- [ ] --no-verify bypass available for emergency commits

---

## TASK-FOS-06-003: Agent-Runner Wrapper for Safe Git Operations

**Type:** backend
**Priority:** medium
**Dependencies:** TASK-FOS-03-002, TASK-FOS-03-004
**Files:** forgeos-server/src/sdk/agent-runner.ts, forgeos-server/src/sdk/config.ts

### Description
Build an updated agent-runner module that uses MCP for claim/advance operations while retaining Git for code commits. Replaces tickets.py --claim with tickets.claim MCP tool call and tickets.py --advance with tickets.complete MCP tool call. Retains the two-commit protocol for code changes (Git remains the code store). Includes filesystem fallback: if FORGEOS_MCP_URL is not set or the MCP server is unreachable, falls back to direct tickets.py CLI calls. Configuration via environment variables: FORGEOS_MCP_URL, FORGEOS_API_KEY, FORGEOS_FALLBACK_ENABLED.

### Acceptance Criteria
- [ ] claimTicket(ticketId, agentName, machineId, operator) calls tickets.claim via MCP HTTP API
- [ ] completeStage(ticketId, evidence) calls tickets.complete via MCP HTTP API
- [ ] releaseTicket(ticketId, reason) calls tickets.release via MCP HTTP API
- [ ] If MCP server is unreachable and FORGEOS_FALLBACK_ENABLED=true, falls back to python3 tickets.py --claim
- [ ] Configuration loaded from environment variables with sensible defaults
- [ ] Returns typed results matching MCP tool output schemas (TicketsClaimOutput, TicketsCompleteOutput)
- [ ] Logs all operations (claim, complete, release, fallback) with structured JSON logging

---

## TASK-FOS-06-004: Webhook State Recovery Endpoint

**Type:** backend
**Priority:** high
**Dependencies:** TASK-FOS-02-001, TASK-FOS-01-002, TASK-FOS-02-003
**Files:** forgeos-server/src/webhooks/github.ts, forgeos-server/src/webhooks/parser.ts, forgeos-server/src/webhooks/reconciliation.ts

### Description
Implement the GitHub push webhook receiver and ghost commit recovery system as specified in Architecture §10.2 and PRD FR-28 through FR-30. POST /api/webhooks/github accepts GitHub push event payloads, verifies the HMAC-SHA256 signature using WEBHOOK_SECRET, parses commit messages to extract ticket operations (CLAIM and WORK patterns), and reconciles DB state with Git state. Reconciliation rules: (1) Git CLAIM exists but DB has no claim → create claim in DB, (2) Git WORK complete but DB still CLAIMED → advance ticket, (3) DB has claim but no Git commit and lease expired → release claim, (4) ambiguous → log warning and flag for admin. All operations are idempotent. Includes periodic reconciliation sweep (configurable interval, default 5 minutes).

### Acceptance Criteria
- [ ] POST /api/webhooks/github endpoint accepts GitHub push event payloads
- [ ] HMAC-SHA256 signature verification using WEBHOOK_SECRET environment variable; rejects invalid signatures with 401
- [ ] Commit message parser extracts ticket_id, agent, machine, operator from CLAIM format regex
- [ ] Commit message parser extracts ticket_id, stage, agent, machine from WORK format regex
- [ ] Ghost commit recovery: Git CLAIM without DB claim → creates claim in DB (idempotent via ON CONFLICT)
- [ ] Ghost commit recovery: Git WORK complete without DB advance → advances ticket in DB
- [ ] Ambiguous state divergence logged as WARNING; NOT auto-resolved; admin notification flag set
- [ ] All reconciliation operations recorded as RECONCILED events in events table
- [ ] Periodic reconciliation sweep runs every reconciliation_interval_seconds (from system_config, default 300s)
- [ ] Reconciliation is idempotent — replaying the same webhook produces the same result
