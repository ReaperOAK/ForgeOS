# Phase 4 — Migration Bridge L3 Tickets

Source blocks: BLK-11-01 (Dual-Mode Engine & Data Synchronization), BLK-11-02 (Agent Migration Path & Validation)

---

## BLK-11-01: Dual-Mode Engine & Data Synchronization

---

## FORGEOS-BE068: Implement Dual-Mode Wrapper for tickets.py

**Type:** backend
**Priority:** critical
**Dependencies:** FORGEOS-BE006, FORGEOS-BE028, FORGEOS-BE045
**Files:** mcp-server/src/migration/dual_mode.py, mcp-server/src/migration/__init__.py, mcp-server/src/migration/config.py
**Tags:** backend, migration, dualMode, wrapper, tickets, phase4, BLK-11-01

### Description

Build the dual-mode wrapper that intercepts calls originally handled by `tickets.py` and routes them to either the PostgreSQL/MCP backend or the filesystem backend depending on feature flag configuration. The wrapper reads from PostgreSQL as primary source with filesystem as fallback when the MCP server is unavailable. During the transition period, writes go to both destinations (database + filesystem) to maintain compatibility. Uses the distributed locking from FORGEOS-BE006 and MCP tools from FORGEOS-BE028.

### Acceptance Criteria

- [ ] Dual-mode wrapper class implements the same interface as tickets.py operations (sync, claim, advance, rework, release, status, validate)
- [ ] Reads from PostgreSQL as primary source when MCP server is available
- [ ] Falls back to filesystem reads when PostgreSQL or MCP server is unreachable
- [ ] Writes to both PostgreSQL (via MCP tools) and filesystem (via JSON file operations) during transition
- [ ] Wrapper logs which mode is active for each operation (database, filesystem, or dual)
- [ ] Fallback triggers are automatic based on connection health check
- [ ] No data loss occurs when switching between modes mid-operation

---

## FORGEOS-BE069: Implement Feature Flag System for Migration

**Type:** backend
**Priority:** critical
**Dependencies:** FORGEOS-BE068
**Files:** mcp-server/src/migration/feature_flags.py, mcp-server/src/migration/config.py, config/migration-flags.yaml
**Tags:** backend, migration, featureFlags, config, toggles, phase4, BLK-11-01

### Description

Implement a feature flag system that controls the migration mode per operation type. Each operation (sync, claim, advance, rework, release, status, validate) has an independent flag with values: `filesystem` (legacy only), `dual` (both), or `database` (MCP only). Flags are loaded from a YAML configuration file and can be updated without restart via file watch or API endpoint. This allows gradual, per-operation cutover from filesystem to database mode.

### Acceptance Criteria

- [ ] Feature flag configuration loaded from config/migration-flags.yaml
- [ ] Each operation type has an independent mode flag: filesystem | dual | database
- [ ] Default mode is `filesystem` for all operations (safe starting point)
- [ ] Flag changes detected without server restart (file watcher or reload API)
- [ ] Feature flag state queryable via API endpoint for monitoring
- [ ] Flag validation rejects invalid operation names or mode values
- [ ] Structured log entry emitted on every flag change with old and new values

---

## FORGEOS-BE070: Implement Filesystem-to-Database Data Import

**Type:** backend
**Priority:** critical
**Dependencies:** FORGEOS-BE068, FORGEOS-BE002
**Files:** mcp-server/src/migration/importer.py, mcp-server/src/migration/transformers.py
**Tags:** backend, migration, import, sync, data, initial, phase4, BLK-11-01

### Description

Implement the initial data import that reads all existing `.github/tickets/*.json` files and `.github/ticket-state/` directory structure and imports them into PostgreSQL. Transform the JSON ticket format to the database schema (mapping fields, resolving stage from directory location, importing history arrays as event records). Handle edge cases: duplicate tickets in multiple state directories, tickets with expired leases, tickets in REWORK state. This is the first step of the migration data flow.

### Acceptance Criteria

- [ ] Import script reads all .github/tickets/*.json files and parses ticket data
- [ ] Ticket stage determined from .github/ticket-state/ directory location
- [ ] JSON fields mapped to database schema columns (ticket_id, title, type, priority, stage, dependencies, file_paths, acceptance_criteria)
- [ ] History arrays from ticket JSON imported as individual event_history records
- [ ] Import handles duplicates: ticket found in multiple state directories resolved by choosing the most advanced stage
- [ ] Import is idempotent: running it multiple times does not create duplicate records
- [ ] Import summary report printed: total tickets found, imported, skipped, errors

---

## FORGEOS-BE071: Implement Bidirectional Sync Engine

**Type:** backend
**Priority:** high
**Dependencies:** FORGEOS-BE070
**Files:** mcp-server/src/migration/sync_engine.py, mcp-server/src/migration/conflict_resolver.py
**Tags:** backend, migration, sync, bidirectional, conflict, reconciliation, phase4, BLK-11-01

### Description

Build the bidirectional synchronization engine that keeps filesystem and database in sync during the dual-mode period. Implement periodic sync (configurable interval, default 60s) that detects changes in either direction: new tickets in filesystem not in DB, stage changes in DB not reflected in filesystem, claim/lease updates. Implement conflict resolution with database-wins strategy: when both sides have diverged, the database state takes precedence. Log all resolved conflicts for audit.

### Acceptance Criteria

- [ ] Periodic sync runs at configurable interval (default 60 seconds)
- [ ] Detects new tickets added to .github/tickets/ filesystem and imports to database
- [ ] Detects stage changes in database and updates .github/ticket-state/ directories (moves JSON files)
- [ ] Detects claim/lease updates in database and updates ticket JSON metadata
- [ ] Conflict resolution uses database-wins strategy when both sides have diverged
- [ ] All sync operations and conflict resolutions logged with structured entries
- [ ] Sync engine can be started/stopped independently of the MCP server

---

## FORGEOS-BE072: Implement Database-to-Filesystem Export

**Type:** backend
**Priority:** high
**Dependencies:** FORGEOS-BE070
**Files:** mcp-server/src/migration/exporter.py
**Tags:** backend, migration, export, rollback, filesystem, backup, phase4, BLK-11-01

### Description

Implement the database-to-filesystem export capability for rollback scenarios. Export all tickets from PostgreSQL back into `.github/tickets/*.json` files and place state copies in `.github/ticket-state/<STAGE>/` directories. This is the safety net: if the MCP/database system fails, the entire state can be exported back to the filesystem format and operations can resume with the legacy `tickets.py`. Export must produce files identical in structure to the originals.

### Acceptance Criteria

- [ ] Export reads all tickets from PostgreSQL and generates .github/tickets/*.json files
- [ ] Each ticket JSON file matches the original JSON schema (ticket_id, title, type, priority, dependencies, file_paths, acceptance_criteria, metadata fields)
- [ ] State copies placed in correct .github/ticket-state/<STAGE>/ directory based on current database stage
- [ ] Export handles active claims: claimed_by, machine_id, operator, lease_expiry included in ticket metadata
- [ ] Export is non-destructive: existing filesystem files backed up before overwrite
- [ ] Export summary report: total tickets exported, stage distribution, active claims count
- [ ] Exported files can be consumed by the original tickets.py without modification

---

## BLK-11-02: Agent Migration Path & Validation

---

## FORGEOS-BE073: Implement Migration Phase A — Background Sync

**Type:** backend
**Priority:** critical
**Dependencies:** FORGEOS-BE071, FORGEOS-BE049
**Files:** mcp-server/src/migration/phases/phase_a.py, mcp-server/src/migration/phases/__init__.py
**Tags:** backend, migration, phaseA, backgroundSync, filesystem, phase4, BLK-11-02

### Description

Implement Migration Phase A: agents continue using the filesystem (via `tickets.py` and `agent-runner.py`) as-is, but the bidirectional sync engine (FORGEOS-BE071) runs in the background, mirroring all filesystem changes to the database. This phase requires zero changes to agent behavior. The filesystem fallback mode from the SDK (FORGEOS-BE049) is the default. Phase A is the read-only validation period where database contents are verified against filesystem truth.

### Acceptance Criteria

- [ ] Phase A configuration activates background sync with all feature flags set to `filesystem` mode
- [ ] Sync engine mirrors every filesystem ticket change to the database within the sync interval
- [ ] Agent behavior is completely unchanged during Phase A (no SDK required)
- [ ] Validation script compares database state to filesystem state and reports discrepancies
- [ ] Phase A can run indefinitely without interfering with agent operations
- [ ] Phase transition gate: database matches filesystem state with zero discrepancies for 24+ hours
- [ ] Phase A entry and exit logged with timestamp and validation results

---

## FORGEOS-BE074: Implement Migration Phase B — SDK with Fallback

**Type:** backend
**Priority:** critical
**Dependencies:** FORGEOS-BE073, FORGEOS-BE050
**Files:** mcp-server/src/migration/phases/phase_b.py, agent-sdk/src/forgeos_sdk/migration.py
**Tags:** backend, migration, phaseB, sdkFallback, transition, phase4, BLK-11-02

### Description

Implement Migration Phase B: agents use the SDK (FORGEOS-BE050 integration hooks) for ticket operations, with automatic fallback to filesystem when the MCP server is unavailable. Feature flags transition per-operation from `filesystem` to `dual`. The CLAIM operation migrates first (via MCP), while WORK commits remain git-based. The SDK filesystem fallback (FORGEOS-BE049) activates transparently if the server is unreachable during an operation.

### Acceptance Criteria

- [ ] Phase B configuration sets claim operation to `dual` mode (MCP primary, filesystem secondary)
- [ ] agent-runner.py CLAIM commit uses SDK when available, falls back to filesystem on failure
- [ ] WORK commits remain purely git-based (no change from current behavior)
- [ ] SDK fallback activates transparently on MCP connection failure
- [ ] Operations succeeded via fallback are logged for manual sync verification
- [ ] Phase transition gate: 95%+ operations succeed via MCP path for 48+ hours
- [ ] Phase B entry and exit logged with timestamp and operation success ratios

---

## FORGEOS-BE075: Implement Migration Phase C — Full MCP

**Type:** backend
**Priority:** high
**Dependencies:** FORGEOS-BE074
**Files:** mcp-server/src/migration/phases/phase_c.py, agent-sdk/src/forgeos_sdk/migration.py
**Tags:** backend, migration, phaseC, fullMCP, primary, phase4, BLK-11-02

### Description

Implement Migration Phase C: agents use the SDK exclusively for ticket operations (claim, advance, rework, release, sync). Feature flags set all operations to `database` mode. The filesystem becomes read-only — the export (FORGEOS-BE072) runs periodically to keep filesystem in sync as a backup, but no agent writes to the filesystem for ticket state. WORK commits (code changes) remain git-based. The SDK no longer attempts filesystem fallback; failures are surfaced as errors.

### Acceptance Criteria

- [ ] Phase C configuration sets all operation flags to `database` mode
- [ ] SDK operations do not attempt filesystem fallback (errors propagated to agents)
- [ ] Periodic database-to-filesystem export runs to maintain backup copies
- [ ] Filesystem ticket files are treated as read-only (no agent writes)
- [ ] WORK commits (code changes via git) remain unchanged
- [ ] Phase transition gate: zero filesystem writes detected for 72+ hours
- [ ] Phase C entry and exit logged with timestamp and error rates

---

## FORGEOS-BE076: Implement Migration Phase D — Filesystem Deprecated

**Type:** backend
**Priority:** medium
**Dependencies:** FORGEOS-BE075
**Files:** mcp-server/src/migration/phases/phase_d.py, mcp-server/src/migration/cleanup.py
**Tags:** backend, migration, phaseD, deprecated, cleanup, final, phase4, BLK-11-02

### Description

Implement Migration Phase D: the filesystem ticket state is fully deprecated. The database is the sole source of truth. Remove filesystem sync, remove fallback code paths, remove dual-mode wrapper. The `.github/ticket-state/` directories and `.github/tickets/*.json` files are archived but no longer maintained by the system. WORK commits remain git-based for code changes only. This phase produces the cleanup script and deprecation configuration.

### Acceptance Criteria

- [ ] Phase D configuration deactivates sync engine and dual-mode wrapper
- [ ] Cleanup script archives .github/ticket-state/ and .github/tickets/ to an archive directory
- [ ] Feature flag system removed or reduced to a single `migration_complete=true` flag
- [ ] SDK filesystem fallback code path disabled (can be removed in future cleanup ticket)
- [ ] All ticket operations use database exclusively with no filesystem references
- [ ] Deprecation warning logged if any code attempts filesystem ticket operations
- [ ] Phase D entry logged with final migration statistics (total operations, error rates, duration)

---

## FORGEOS-BE077: Implement Shadow Mode Validation Engine

**Type:** backend
**Priority:** high
**Dependencies:** FORGEOS-BE073
**Files:** mcp-server/src/migration/shadow.py, mcp-server/src/migration/validators.py
**Tags:** backend, migration, shadow, validation, comparison, divergence, phase4, BLK-11-02

### Description

Build the shadow mode validation engine that runs both filesystem and database operations in parallel and compares results. For each ticket operation, the shadow engine executes the operation via both paths (filesystem and MCP/database), compares the outcomes, and logs any divergences. Divergences are classified by severity: CRITICAL (state mismatch), WARNING (timing difference), INFO (metadata format difference). Shadow mode is active during Phases A and B to build confidence before full cutover.

### Acceptance Criteria

- [ ] Shadow engine intercepts ticket operations and executes via both filesystem and database paths
- [ ] Results compared field-by-field: ticket_id, stage, claimed_by, lease_expiry, dependencies
- [ ] Divergences classified: CRITICAL (stage/claim mismatch), WARNING (timing >5s), INFO (format differences)
- [ ] Structured divergence report logged with operation, filesystem result, database result, classification
- [ ] CRITICAL divergences trigger an alert (structured log at ERROR level)
- [ ] Shadow mode configurable to enable/disable per operation type
- [ ] Divergence summary dashboard endpoint returns aggregated divergence statistics

---

## FORGEOS-BE078: Implement Automated Rollback Triggers

**Type:** backend
**Priority:** high
**Dependencies:** FORGEOS-BE072, FORGEOS-BE077
**Files:** mcp-server/src/migration/rollback.py, mcp-server/src/migration/health_monitor.py
**Tags:** backend, migration, rollback, automated, healthCheck, safety, phase4, BLK-11-02

### Description

Implement automated rollback triggers that revert the migration to a previous phase when health checks fail. Monitor MCP server health, database connectivity, and operation success rates. If the MCP server is unreachable for >5 minutes, or if operation error rate exceeds 10% over a rolling 15-minute window, automatically trigger a rollback: switch feature flags to the previous phase's configuration and activate the database-to-filesystem export (FORGEOS-BE072). Emit alerts for human operator awareness.

### Acceptance Criteria

- [ ] Health monitor tracks MCP server availability with configurable probe interval (default 30s)
- [ ] Health monitor tracks operation success rate over rolling 15-minute window
- [ ] Rollback triggered when MCP server unreachable for >5 minutes continuously
- [ ] Rollback triggered when operation error rate exceeds 10% in 15-minute window
- [ ] Rollback action: feature flags reverted to previous phase, export executed, alert emitted
- [ ] Rollback is idempotent: triggering multiple times does not cause additional side effects
- [ ] Rollback event logged with trigger reason, previous phase, new phase, and timestamp

---

## FORGEOS-BE079: Implement agent-runner.py Migration Evolution

**Type:** backend
**Priority:** high
**Dependencies:** FORGEOS-BE074, FORGEOS-BE050
**Files:** .github/agent-runner.py, mcp-server/src/migration/runner_adapter.py
**Tags:** backend, migration, agentRunner, evolution, twoCommit, phase4, BLK-11-02

### Description

Evolve `agent-runner.py` to support the three migration evolution stages. Phase 1: agent-runner.py unchanged (pure filesystem + git). Phase 2: CLAIM commit performed via MCP SDK (FORGEOS-BE050), WORK commit still via git. Phase 3: full MCP for claim/advance/release, git only for WORK commits (code changes). The runner adapter checks the current migration phase from feature flags and routes operations accordingly. This preserves the two-commit protocol while migrating the state management layer.

### Acceptance Criteria

- [ ] agent-runner.py detects current migration phase from feature flag configuration
- [ ] Phase 1 behavior: CLAIM via git push, WORK via git push (unchanged from current)
- [ ] Phase 2 behavior: CLAIM via SDK (MCP), WORK via git push (hybrid)
- [ ] Phase 3 behavior: CLAIM via SDK, ADVANCE via SDK, WORK via git push (code only)
- [ ] Runner adapter maps agent-runner.py operations to SDK calls in Phase 2 and 3
- [ ] Fallback: if SDK call fails in Phase 2, runner reverts to git-based claim
- [ ] Migration phase transition does not require agent-runner.py code changes (config-driven)
