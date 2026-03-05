# Phase 3 — Webhooks & Notifications L3 Tickets

Source blocks: BLK-09-01 (Inbound Webhook Processing), BLK-09-02 (Outbound Notification System)

---

## FORGEOS-BE059: Implement Webhook HTTP Receiver Endpoint

**Type:** backend
**Priority:** high
**Dependencies:** FORGEOS-BE017, FORGEOS-BE054
**Files:** mcp-server/src/api/routes/webhooks.py, mcp-server/src/services/webhook_service.py, mcp-server/src/services/__init__.py
**Tags:** backend, webhooks, receiver, http, phase3, BLK-09-01

### Description

Build the inbound webhook HTTP endpoint (`POST /api/webhooks/:source`) that accepts JSON payloads from external systems. The endpoint authenticates webhook requests using the auth middleware (FORGEOS-BE054), validates the payload structure, and routes the event to the appropriate internal handler based on the source parameter and event type. The HTTP transport from FORGEOS-BE017 hosts the endpoint.

### Acceptance Criteria

- [ ] POST /api/webhooks/:source endpoint accepts JSON webhook payloads
- [ ] Source parameter identifies the webhook origin (github, custom, etc.)
- [ ] Request payload validated against expected schema per source type
- [ ] Events routed to internal handlers based on source and event_type header/field
- [ ] Invalid payloads return 400 Bad Request with descriptive error
- [ ] Webhook receipt acknowledged with 202 Accepted before processing (async handling)

---

## FORGEOS-BE060: Implement GitHub Webhook Signature Verification

**Type:** backend
**Priority:** high
**Dependencies:** FORGEOS-BE059
**Files:** mcp-server/src/webhooks/github_handler.py, mcp-server/src/webhooks/__init__.py, mcp-server/src/webhooks/signature.py
**Tags:** backend, webhooks, github, signature, hmac, phase3, BLK-09-01

### Description

Implement GitHub webhook signature verification using HMAC-SHA256. The webhook secret is stored as an environment variable (never hardcoded). Verify the `X-Hub-Signature-256` header against the computed HMAC of the request body. Reject requests with invalid or missing signatures. Parse GitHub event types from the `X-GitHub-Event` header.

### Acceptance Criteria

- [ ] Webhook secret loaded from GITHUB_WEBHOOK_SECRET environment variable
- [ ] HMAC-SHA256 signature computed from request body and compared to X-Hub-Signature-256 header
- [ ] Requests with invalid signature rejected with 403 Forbidden
- [ ] Requests with missing signature header rejected with 401 Unauthorized
- [ ] GitHub event type extracted from X-GitHub-Event header for routing
- [ ] Signature verification is constant-time to prevent timing attacks (hmac.compare_digest)

---

## FORGEOS-BE061: Implement Push Event Handler for Sync

**Type:** backend
**Priority:** high
**Dependencies:** FORGEOS-BE060, FORGEOS-BE033
**Files:** mcp-server/src/webhooks/github_handler.py, mcp-server/src/services/webhook_service.py
**Tags:** backend, webhooks, github, push, sync, phase3, BLK-09-01

### Description

Implement the GitHub push event handler that triggers `tickets.sync` when relevant pushes are detected. On push events to the main branch or ticket-related branches, invoke the sync engine (FORGEOS-BE033) to re-evaluate dependencies and unblock tickets. Filter push events to only trigger sync when ticket-related files are modified (`.github/tickets/`, `.github/ticket-state/`).

### Acceptance Criteria

- [ ] Push events to main branch trigger a full tickets.sync operation
- [ ] Push events to ticket branches trigger sync if ticket-related files are modified
- [ ] File path filtering checks for changes in .github/tickets/ or .github/ticket-state/
- [ ] Sync results logged including tickets released, unblocked, and errors
- [ ] Non-ticket pushes are acknowledged but do not trigger sync
- [ ] Handler returns the sync summary as the webhook response payload

---

## FORGEOS-BE062: Implement CI Status Event Handler

**Type:** backend
**Priority:** high
**Dependencies:** FORGEOS-BE060, FORGEOS-BE030
**Files:** mcp-server/src/webhooks/github_handler.py
**Tags:** backend, webhooks, github, ci, status, phase3, BLK-09-01

### Description

Implement the handler for GitHub CI status events (check_run and status events). When CI checks pass for a ticket's branch, automatically advance the ticket past the CI stage. When CI checks fail, trigger a rework with the failure reason. Map GitHub check names/contexts to ticket IDs using branch naming conventions.

### Acceptance Criteria

- [ ] check_run completed events processed, mapping to ticket IDs via branch name convention
- [ ] CI pass (conclusion: success) triggers tickets.advance for the ticket in CI stage
- [ ] CI failure (conclusion: failure) triggers tickets.rework with failure details
- [ ] Only tickets currently in the CI stage are affected by CI status events
- [ ] Handler extracts relevant failure details (check name, output summary) for rework reason
- [ ] Duplicate CI events for same ticket are handled idempotently

---

## FORGEOS-BE063: Implement PR Event Handler

**Type:** backend
**Priority:** medium
**Dependencies:** FORGEOS-BE060
**Files:** mcp-server/src/webhooks/github_handler.py, mcp-server/src/services/pr_service.py
**Tags:** backend, webhooks, github, pullrequest, phase3, BLK-09-01

### Description

Implement the handler for GitHub pull request events. Link pull requests to ticket IDs by parsing the PR title or branch name for ticket ID patterns (e.g., `[FORGEOS-BE028]` or branch `FORGEOS-BE028/feature`). Store the PR URL and status on the ticket record. Update ticket metadata when PRs are opened, merged, or closed.

### Acceptance Criteria

- [ ] PR opened events extract ticket_id from PR title or branch name using regex
- [ ] Ticket record updated with PR URL, PR number, and PR status (open, merged, closed)
- [ ] PR merged events logged in the ticket's event history
- [ ] PR closed without merge logged as a distinct event
- [ ] Multiple PRs can be linked to the same ticket
- [ ] Ticket IDs not found in the database produce a warning log but do not error

---

## FORGEOS-BE064: Implement Notification Event Queue

**Type:** backend
**Priority:** high
**Dependencies:** FORGEOS-BE012, FORGEOS-BE003
**Files:** mcp-server/src/notifications/queue.py, mcp-server/src/notifications/__init__.py, database/alembic/versions/012_notification_queue.py
**Tags:** backend, notifications, queue, database, phase3, BLK-09-02

### Description

Build the in-database notification event queue for reliable delivery. Create a notification_queue table via Alembic migration with columns for event_type, payload, status (pending, processing, delivered, failed, dead_letter), retry_count, next_retry_at, and created_at. Implement enqueue and dequeue operations with proper locking to prevent duplicate processing.

### Acceptance Criteria

- [ ] notification_queue table created via Alembic migration with all required columns
- [ ] Enqueue operation inserts notification with pending status and JSON payload
- [ ] Dequeue operation atomically selects and locks the next pending notification (SKIP LOCKED)
- [ ] Status transitions enforced: pending → processing → delivered/failed
- [ ] Failed notifications increment retry_count and set next_retry_at based on backoff schedule
- [ ] Index on (status, next_retry_at) for efficient dequeue queries

---

## FORGEOS-BE065: Implement State Change Notification Emitter

**Type:** backend
**Priority:** high
**Dependencies:** FORGEOS-BE064, FORGEOS-BE030
**Files:** mcp-server/src/notifications/emitter.py, mcp-server/src/services/ticket_service.py
**Tags:** backend, notifications, emitter, statechange, phase3, BLK-09-02

### Description

Implement the notification emitter that creates queue entries when ticket state changes occur. Integrate with the ticket service layer: after advance, rework, claim, or release operations, enqueue a notification containing the ticket context, change details, and actor information. Support notification types: stage_changed, ticket_claimed, ticket_released, ticket_reworked, lease_expiring.

### Acceptance Criteria

- [ ] Stage transition (advance) enqueues a stage_changed notification with from/to stages
- [ ] Claim operations enqueue a ticket_claimed notification with agent and machine details
- [ ] Release operations enqueue a ticket_released notification
- [ ] Rework operations enqueue a ticket_reworked notification with rejection reason
- [ ] Notification payload includes ticket_id, event_type, actor, timestamp, and change details
- [ ] Emitter is called from the ticket service layer (not duplicated across MCP/REST)

---

## FORGEOS-BE066: Implement Notification Channel Configuration

**Type:** backend
**Priority:** medium
**Dependencies:** FORGEOS-BE064
**Files:** mcp-server/src/notifications/channels.py, mcp-server/src/notifications/config.py, database/alembic/versions/013_notification_channels.py
**Tags:** backend, notifications, channels, slack, webhook, phase3, BLK-09-02

### Description

Implement configurable notification channels that determine where notifications are delivered. Support outbound webhook URLs (POST JSON to configured endpoints) and Slack incoming webhooks. Create a notification_channels table to store channel configurations. Each channel can filter by event types (e.g., only stage_changed events sent to Slack).

### Acceptance Criteria

- [ ] notification_channels table created via Alembic migration (channel_id, type, config, event_filter)
- [ ] Webhook channel sends POST requests with JSON payload to configured URL
- [ ] Slack channel formats notification as Slack Block Kit message and sends to incoming webhook URL
- [ ] Channels can filter by event_type (e.g., only send stage_changed and ticket_reworked)
- [ ] Channel configuration manageable via admin API or environment variables
- [ ] Channel delivery failure does not block the notification queue processing

---

## FORGEOS-BE067: Implement Retry Logic and Dead-Letter Handling

**Type:** backend
**Priority:** medium
**Dependencies:** FORGEOS-BE064, FORGEOS-BE066
**Files:** mcp-server/src/notifications/processor.py, mcp-server/src/notifications/queue.py
**Tags:** backend, notifications, retry, deadletter, reliability, phase3, BLK-09-02

### Description

Implement the notification processor that dequeues pending notifications, delivers them to configured channels, and handles failures. Implement exponential backoff retry logic (1min, 5min, 15min, 1hr) with configurable maximum retry count. Notifications exceeding max retries move to dead_letter status. Run as a background asyncio task.

### Acceptance Criteria

- [ ] Background processor dequeues and delivers pending notifications on a configurable interval
- [ ] Successful delivery updates notification status to delivered with delivery timestamp
- [ ] Failed delivery increments retry_count and schedules next_retry_at with exponential backoff
- [ ] Backoff schedule: 1 min, 5 min, 15 min, 1 hour (configurable)
- [ ] Notifications exceeding max retries (default 5) move to dead_letter status
- [ ] Dead-letter notifications queryable via admin API for manual inspection and replay
