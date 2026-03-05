# Authentication & Security Tickets

## TASK-FOS-04-001: API Key Authentication Middleware

**Type:** backend
**Priority:** high
**Dependencies:** TASK-FOS-02-001, TASK-FOS-01-002, TASK-FOS-02-002
**Files:** forgeos-server/src/middleware/auth.ts, forgeos-server/src/auth/keys.ts, forgeos-server/src/auth/roles.ts

### Description
Implement API key authentication middleware for the ForgeOS MCP server as specified in Architecture §7.1. The middleware extracts the API key from the Authorization: Bearer header, computes its SHA-256 hash, and looks up the matching agent in the agents table. If found and active (is_active=true, revoked_at IS NULL), it populates the request context with the agent's identity (id, name, role, permissions, machine_id). Implement the role-based authorization matrix from Architecture §7.2 — each agent role can only perform operations matching their SDLC stage ownership. Include a key generation utility that creates cryptographically secure API keys, hashes them, and stores the hash in the agents table.

### Acceptance Criteria
- [ ] Middleware extracts API key from Authorization: Bearer <key> header
- [ ] Key validated via SHA-256 hash lookup in agents table (api_key_hash column)
- [ ] Returns 401 Unauthorized with UNAUTHORIZED error if key is missing, invalid, or revoked
- [ ] Returns 403 Forbidden with FORBIDDEN error if agent role doesn't have permission for the requested operation
- [ ] Role-based permission matrix enforced: Backend can only claim BACKEND stage, QA can reject, Admin has full access, etc.
- [ ] Key validation latency under 5ms (indexed lookup on api_key_hash)
- [ ] generateApiKey() creates a 32-byte cryptographically random key, returns plaintext once, stores SHA-256 hash
- [ ] Middleware sets PostgreSQL session variables (app.agent_role, app.agent_name, app.agent_id) for RLS enforcement
- [ ] Health endpoint (/health) is exempt from authentication

---

## TASK-FOS-04-002: Agent Registration and Identity Management

**Type:** backend
**Priority:** high
**Dependencies:** TASK-FOS-04-001
**Files:** forgeos-server/src/auth/registration.ts, forgeos-server/src/api/routes/admin.ts

### Description
Implement agent and machine registration endpoints. POST /api/admin/agents creates a new agent record with name, role, and permissions, generates an API key, and returns the agent identity with the plaintext key (shown once). POST /api/admin/agents/:id/revoke revokes an agent's API key. GET /api/admin/agents lists all registered agents (without key hashes). Include machine registration: each API call updates the agent's last_seen timestamp for staleness tracking. Admin endpoints require admin role authentication.

### Acceptance Criteria
- [ ] POST /api/admin/agents creates agent record, generates API key, returns {agent, api_key: plaintext}
- [ ] API key plaintext is returned exactly once at creation time; never stored or logged in plaintext
- [ ] POST /api/admin/agents/:id/revoke sets revoked_at timestamp; subsequent requests with that key return 401
- [ ] GET /api/admin/agents returns paginated list of agents with id, name, role, is_active, created_at (no key hashes)
- [ ] All admin endpoints require admin role authentication (403 for non-admin callers)
- [ ] Machine last_seen updated on every authenticated API call for staleness detection
- [ ] Agent sessions table updated with session_token matching MCP session ID

---

## TASK-FOS-04-003: File-Level Mutex Implementation

**Type:** backend
**Priority:** high
**Dependencies:** TASK-FOS-01-002, TASK-FOS-02-002
**Files:** forgeos-server/src/db/file-mutex.ts

### Description
Implement file-level mutex logic using the file_locks table. When a ticket is claimed, all files in its file_paths array must be locked in the file_locks table. Before locking, check for conflicts: if any file in file_paths is already locked by an active (released_at IS NULL) lock belonging to a different ticket, the claim must be denied with a FILE_CONFLICT error. File locks are released (released_at set to NOW()) when the ticket's claim is released, when the ticket advances to the next stage, or when the ticket is rejected. The partial unique index on file_locks(file_path) WHERE released_at IS NULL enforces the mutex at the database level.

### Acceptance Criteria
- [ ] acquireFileLocks(ticketId, filePaths, agentId, machineId) inserts lock records for all file paths
- [ ] Uses INSERT ... ON CONFLICT (file_path) WHERE released_at IS NULL DO NOTHING to handle concurrent lock attempts
- [ ] checkFileConflicts(ticketId, filePaths) returns list of conflicting files with their owning ticket_ids
- [ ] Returns FILE_CONFLICT error with details of which files are locked by which tickets
- [ ] releaseFileLocks(ticketId) sets released_at = NOW() for all active locks belonging to the ticket
- [ ] FILE_LOCKED and FILE_UNLOCKED events recorded in events table
- [ ] Concurrent file lock attempts on the same file from different tickets: exactly one succeeds
