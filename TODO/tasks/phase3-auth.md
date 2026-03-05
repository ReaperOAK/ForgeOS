# Phase 3 — Authentication & Authorization L3 Tickets

Source blocks: BLK-08-01 (Identity & Authentication), BLK-08-02 (Authorization & Audit)

---

## FORGEOS-BE051: Implement Agent API Key Authentication

**Type:** backend
**Priority:** critical
**Dependencies:** FORGEOS-BE015, FORGEOS-BE002
**Files:** mcp-server/src/auth/agent_auth.py, mcp-server/src/auth/__init__.py, database/alembic/versions/010_api_keys.py
**Tags:** backend, auth, apikey, agent, phase3, BLK-08-01

### Description

Implement agent identity verification using pre-shared API keys. Each registered agent receives a unique API key that is sent with MCP requests. Create the API key storage table (hashed, never stored in plaintext), key validation logic, and agent identity lookup. API keys are managed via environment variables or database records. The core tables migration (FORGEOS-BE002) provides the agents table for identity storage.

### Acceptance Criteria

- [ ] API key table created via Alembic migration storing hashed keys with agent_id reference
- [ ] API key validation function accepts a key and returns the agent identity or raises AuthenticationError
- [ ] Keys are stored as bcrypt or SHA-256 hashes, never in plaintext
- [ ] Key generation utility creates new API keys for registered agents
- [ ] Agent identity includes agent_id, agent_name, and role for downstream authorization
- [ ] Invalid or expired API keys produce clear error messages in MCP error format

---

## FORGEOS-BE052: Implement Machine Registration and Verification

**Type:** backend
**Priority:** high
**Dependencies:** FORGEOS-BE051
**Files:** mcp-server/src/auth/machine_auth.py, mcp-server/src/services/machine_service.py
**Tags:** backend, auth, machine, registration, phase3, BLK-08-01

### Description

Implement machine registration and identity verification. Each machine running agents registers with a unique machine_id (hostname or UUID). Machine registration records the hostname, first-seen timestamp, and last-seen timestamp. On each request, the machine_id is verified against the registry. Unknown machines can be auto-registered or rejected based on configuration.

### Acceptance Criteria

- [ ] Machine registration endpoint or MCP tool creates machine records in the machines table
- [ ] Machine identity verified on each request by matching machine_id to registry
- [ ] Auto-registration mode allows unknown machines to self-register (configurable)
- [ ] Strict mode rejects requests from unregistered machines with 403 error
- [ ] last_seen timestamp updated on each authenticated request from a machine
- [ ] Machine identity includes machine_id, hostname, and registration timestamp

---

## FORGEOS-BE053: Implement Operator Token Authentication

**Type:** backend
**Priority:** high
**Dependencies:** FORGEOS-BE051
**Files:** mcp-server/src/auth/operator_auth.py, mcp-server/src/services/operator_service.py
**Tags:** backend, auth, operator, token, jwt, phase3, BLK-08-01

### Description

Implement operator (human) authentication using token-based auth (JWT or simple bearer tokens). Operators authenticate via the REST API to perform dashboard actions. Implement token generation on login, token validation on each request, token expiry, and token refresh. Operator records are stored in the operators table from FORGEOS-BE002.

### Acceptance Criteria

- [ ] Token generation endpoint (POST /api/auth/login) accepts operator credentials and returns a bearer token
- [ ] Token validation extracts operator identity from the bearer token on each REST request
- [ ] Tokens include operator_id, name, role, and expiry timestamp
- [ ] Token expiry enforced (configurable, default 8 hours)
- [ ] Token refresh endpoint extends the session without re-authentication
- [ ] Operator credentials stored as bcrypt hashes in the operators table

---

## FORGEOS-BE054: Implement Auth Middleware for MCP and REST

**Type:** backend
**Priority:** critical
**Dependencies:** FORGEOS-BE051, FORGEOS-BE017
**Files:** mcp-server/src/middleware/auth_middleware.py, mcp-server/src/middleware/__init__.py
**Tags:** backend, auth, middleware, mcp, rest, phase3, BLK-08-01

### Description

Create unified authentication middleware that intercepts both MCP tool calls and REST API requests. For MCP, extract the API key from the request metadata and validate agent identity. For REST, extract the bearer token from the Authorization header and validate operator identity. The middleware populates a request context with the authenticated identity for downstream use by authorization and audit layers.

### Acceptance Criteria

- [ ] MCP middleware extracts API key from MCP request metadata or transport headers
- [ ] REST middleware extracts bearer token from Authorization header
- [ ] Middleware validates credentials and populates request context with authenticated identity
- [ ] Unauthenticated requests receive MCP error or HTTP 401 Unauthorized
- [ ] Health and readiness endpoints are excluded from authentication requirements
- [ ] Request context includes identity_type (agent/operator/admin), identity_id, role, and machine_id

---

## FORGEOS-BE055: Implement Role-Based Claim Restrictions

**Type:** backend
**Priority:** critical
**Dependencies:** FORGEOS-BE054, FORGEOS-BE028
**Files:** mcp-server/src/auth/authorization.py, mcp-server/src/services/ticket_service.py
**Tags:** backend, auth, rbac, claims, restrictions, phase3, BLK-08-02

### Description

Implement role-based claim restrictions that enforce stage ownership. Agents can only claim tickets matching their role's SDLC stage: Backend agent can only claim tickets in BACKEND stage, QA agent in QA stage, etc. The authorization layer checks the agent's role against the ticket's current stage before allowing a claim. Map the 14 agent roles to their authorized stages.

### Acceptance Criteria

- [ ] Role-to-stage mapping defined for all 14 agent types (Backend→BACKEND, QA→QA, etc.)
- [ ] Claim operations validate that the agent's role matches the ticket's current stage
- [ ] Mismatched role-stage claim attempts rejected with descriptive authorization error
- [ ] Operator role can claim on behalf of any agent role (with explicit role override)
- [ ] Authorization check integrated into the claim service (both MCP and REST paths)
- [ ] Role mapping is configurable (not hardcoded) for future role additions

---

## FORGEOS-BE056: Implement Operator Machine-Scoped Permissions

**Type:** backend
**Priority:** high
**Dependencies:** FORGEOS-BE054, FORGEOS-BE052
**Files:** mcp-server/src/auth/authorization.py, mcp-server/src/services/operator_service.py
**Tags:** backend, auth, operator, permissions, machine, phase3, BLK-08-02

### Description

Implement operator permission scoping: operators can only perform operations on machines they are registered to. Create the operator-machine binding table and enforce that claim, advance, and rework operations via the REST API are constrained to the operator's registered machines. Admin operators bypass machine restrictions.

### Acceptance Criteria

- [ ] Operator-machine binding table created (operator_id, machine_id, registered_at)
- [ ] REST operations validate that operator is bound to the machine_id in the request
- [ ] Unbound operator-machine pair rejected with 403 Forbidden
- [ ] Admin operators bypass machine binding checks
- [ ] Operators can register to multiple machines
- [ ] Binding management endpoints (add/remove machine binding) for admin use

---

## FORGEOS-BE057: Implement Admin Force Operations

**Type:** backend
**Priority:** medium
**Dependencies:** FORGEOS-BE055
**Files:** mcp-server/src/api/routes/admin.py, mcp-server/src/services/admin_service.py
**Tags:** backend, auth, admin, force, operations, phase3, BLK-08-02

### Description

Implement admin-only elevated operations: force-release (release any claim regardless of owner), force-advance (advance any ticket regardless of claim status), and system configuration updates (rate limits, lease duration). These operations require admin role authentication and produce audit log entries with elevated-operation flag.

### Acceptance Criteria

- [ ] POST /api/admin/tickets/:id/force-release releases any active claim
- [ ] POST /api/admin/tickets/:id/force-advance moves ticket to next stage regardless of claim
- [ ] PATCH /api/admin/config updates configurable system parameters (lease duration, rate limits)
- [ ] All admin operations require admin role; non-admin receives 403 Forbidden
- [ ] Every admin operation creates an audit log entry with elevated_operation=true flag
- [ ] Admin operations include a required reason field for audit trail

---

## FORGEOS-BE058: Implement Comprehensive Audit Logging

**Type:** backend
**Priority:** high
**Dependencies:** FORGEOS-BE054, FORGEOS-BE012
**Files:** mcp-server/src/services/audit_service.py, database/alembic/versions/011_audit_log.py
**Tags:** backend, auth, audit, logging, security, phase3, BLK-08-02

### Description

Implement comprehensive audit logging for all authenticated operations. Every MCP tool call and REST API request logs: identity (agent/operator/admin), operation type, target resource, timestamp, result (success/failure), and source IP/machine. Create a dedicated audit_log table via migration. Audit records are append-only and cannot be modified or deleted.

### Acceptance Criteria

- [ ] Audit log table created via Alembic migration (audit_id, identity_type, identity_id, operation, target, result, timestamp, metadata)
- [ ] Every authenticated MCP tool call produces an audit log entry
- [ ] Every authenticated REST API request produces an audit log entry
- [ ] Audit entries include identity_type, identity_id, operation, target_resource, result, and source_machine
- [ ] Audit records are append-only (application-level policy: no UPDATE, no DELETE)
- [ ] GET /api/admin/audit endpoint allows admin to query audit logs with filters (identity, operation, time range)
