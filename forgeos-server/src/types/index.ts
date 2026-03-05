/**
 * ForgeOS Type Definitions
 *
 * Canonical TypeScript interfaces, enums, and type aliases for the ForgeOS
 * multi-agent orchestration system. These types mirror the PostgreSQL schema
 * defined in `db/migrations/001_initial.sql` and are consumed by every MCP
 * tool handler, middleware, and database module.
 *
 * @remarks
 * All types are pure declarations with no runtime dependencies. The only
 * runtime values exported are the `SDLC_FLOWS` constant and the
 * validation arrays (`TICKET_STAGES`, `TICKET_TYPES`, etc.) used by Zod schemas.
 *
 * @see {@link https://spec.modelcontextprotocol.io/ | MCP Specification}
 * @module types
 * @packageDocumentation
 * @last_reviewed 2026-03-06T00:00:00Z
 */

// ── Enums ──

/**
 * Ticket lifecycle status.
 *
 * Represents the current operational state of a ticket within the system.
 * Transitions between statuses are enforced by the SDLC stage pipeline.
 *
 * - `READY` — Unblocked and available for claim.
 * - `BLOCKED` — Waiting on unresolved `depends_on` tickets.
 * - `CLAIMED` — Locked by an agent via the two-commit protocol.
 * - `IN_PROGRESS` — Agent is actively working on the ticket.
 * - `DONE` — All stages complete, validated, and closed.
 * - `FAILED` — Terminated due to unrecoverable error.
 * - `ESCALATED` — Rework count exceeded `max_reworks`; requires human intervention.
 */
export type TicketStatus = 'READY' | 'BLOCKED' | 'CLAIMED' | 'IN_PROGRESS' | 'DONE' | 'FAILED' | 'ESCALATED';

/**
 * SDLC pipeline stage.
 *
 * Each ticket type traverses a defined subset of these 13 stages in strict
 * order. Stage transitions are managed by `tickets.py` and enforced by the
 * MCP tool handlers.
 *
 * Stages map to specialized agents:
 * - `READY` — Entry point; ticket is unblocked.
 * - `RESEARCH` — Research Analyst performs evidence-based analysis.
 * - `ARCHITECT` — Architect produces ADRs and API contracts.
 * - `PRODUCT_MANAGER` — Product Manager defines requirements.
 * - `UI_DESIGN` — UIDesigner creates mockups and design specs.
 * - `BACKEND` — Backend Engineer implements server-side logic.
 * - `FRONTEND` — Frontend Engineer implements UI components.
 * - `QA` — QA Engineer verifies test coverage and correctness.
 * - `SECURITY` — Security Engineer runs STRIDE/OWASP review.
 * - `CI` — CI Reviewer checks lint, types, and complexity.
 * - `DOCUMENTATION` — Documentation Specialist writes docs.
 * - `VALIDATOR` — Validator performs independent DoD review.
 * - `DONE` — Terminal state; lifecycle complete.
 */
export type TicketStage =
  | 'READY' | 'RESEARCH' | 'ARCHITECT' | 'PRODUCT_MANAGER' | 'UI_DESIGN'
  | 'BACKEND' | 'FRONTEND' | 'QA' | 'SECURITY' | 'CI'
  | 'DOCUMENTATION' | 'VALIDATOR' | 'DONE';

/**
 * Ticket classification type.
 *
 * Determines which SDLC flow (stage sequence) a ticket follows. See
 * {@link SDLC_FLOWS} for the complete mapping of type to stage sequence.
 *
 * - `backend` — Server-side implementation (APIs, business logic).
 * - `frontend` — Client-side UI implementation.
 * - `fullstack` — Combined backend + frontend work.
 * - `infra` — Infrastructure and DevOps changes.
 * - `security` — Security-focused tickets.
 * - `docs` — Documentation-only changes.
 * - `research` — Evidence-based research and PoC work.
 * - `architecture` — Architecture design and ADRs.
 * - `product` — Product management and requirements.
 * - `design` — UI/UX design work.
 */
export type TicketType =
  | 'backend' | 'frontend' | 'fullstack' | 'infra' | 'security'
  | 'docs' | 'research' | 'architecture' | 'product' | 'design';

/**
 * Ticket priority level.
 *
 * Used by the `tickets.next` tool to sort available tickets. Higher-priority
 * tickets are returned first when multiple are in `READY` state.
 *
 * - `critical` — Blocking other work; process immediately.
 * - `high` — Important; process before medium/low.
 * - `medium` — Standard priority.
 * - `low` — Process when no higher-priority work is available.
 */
export type TicketPriority = 'critical' | 'high' | 'medium' | 'low';

/**
 * Audit event type recorded in the `events` table.
 *
 * Every state change in the system emits an event with one of these types.
 * Events provide a complete audit trail for compliance and debugging.
 *
 * @remarks
 * `HEARTBEAT` and `COMPLETED` are application-level event types not yet
 * present in the PostgreSQL `event_type` enum. Inserting these directly
 * will fail at the database level until the SQL enum is extended.
 *
 * - `CREATED` — Ticket was created.
 * - `CLAIMED` — Agent claimed a ticket via two-commit protocol.
 * - `RELEASED` — Agent voluntarily released a claim.
 * - `STAGE_ADVANCED` — Ticket moved to the next SDLC stage.
 * - `STAGE_REJECTED` — Ticket was rejected and sent to rework.
 * - `UPDATED` — Ticket metadata was updated.
 * - `SPAWNED` — A child ticket was created from a parent.
 * - `ESCALATED` — Rework limit exceeded; human intervention needed.
 * - `LEASE_EXTENDED` — Agent extended their lease on a ticket.
 * - `FORCE_RELEASED` — Lease expired or admin forced release.
 * - `RECONCILED` — System reconciled ticket state.
 * - `FILE_LOCKED` — File lock acquired for a ticket.
 * - `FILE_UNLOCKED` — File lock released.
 * - `HEARTBEAT` — Agent liveness signal (app-level only).
 * - `COMPLETED` — Ticket reached terminal DONE state (app-level only).
 */
export type EventType =
  | 'CREATED' | 'CLAIMED' | 'RELEASED' | 'STAGE_ADVANCED' | 'STAGE_REJECTED'
  | 'UPDATED' | 'SPAWNED' | 'ESCALATED' | 'LEASE_EXTENDED' | 'FORCE_RELEASED'
  | 'RECONCILED' | 'FILE_LOCKED' | 'FILE_UNLOCKED' | 'HEARTBEAT' | 'COMPLETED';

// ── Core Domain Models ──

/**
 * Ticket entity matching the `tickets` database table.
 *
 * Represents a unit of work in the ForgeOS orchestration system. Each ticket
 * has a type that determines its SDLC flow, a status reflecting its current
 * operational state, and a stage indicating where it sits in the pipeline.
 *
 * All 28 fields map 1:1 to PostgreSQL columns defined in `001_initial.sql`.
 */
export interface Ticket {
  /** UUID primary key (database-generated). */
  id: string;
  /** Human-readable ticket identifier (e.g., `TASK-FOS-02-002`). Unique. */
  ticket_id: string;
  /** FK to the `projects` table. `null` for tickets not scoped to a project. */
  project_id: string | null;
  /** Short summary of the work to be done. */
  title: string;
  /** Detailed description of requirements and context. */
  description: string | null;
  /** Classification that determines the SDLC stage flow. */
  type: TicketType;
  /** Urgency level used for queue ordering. */
  priority: TicketPriority;
  /** Current operational state (e.g., `READY`, `CLAIMED`, `DONE`). */
  status: TicketStatus;
  /** Current position in the SDLC pipeline. */
  stage: TicketStage;
  /** Ordered array of stages this ticket must traverse. Derived from {@link SDLC_FLOWS}. */
  sdlc_flow: TicketStage[];
  /** UUID of the agent that currently holds the claim. `null` if unclaimed. */
  claimed_by: string | null;
  /** Human-readable name of the claiming agent. */
  claimed_by_name: string | null;
  /** Hostname of the machine where the claiming agent runs. */
  machine_id: string | null;
  /** Human operator who initiated the agent. */
  operator: string | null;
  /** ISO 8601 timestamp when the current lease expires. `null` if unclaimed. */
  lease_expiry: string | null;
  /** Default lease duration in minutes (configurable per project). */
  lease_duration_minutes: number;
  /** Array of `ticket_id` values that must reach `DONE` before this ticket unblocks. */
  depends_on: string[];
  /** Workspace-relative file paths within this ticket's write scope. */
  file_paths: string[];
  /** List of conditions that must be satisfied for the ticket to pass validation. */
  acceptance_criteria: string[];
  /** Free-form labels for filtering and categorization. */
  tags: string[];
  /** Number of times this ticket has been sent back to rework. */
  rework_count: number;
  /** Maximum allowed rework attempts before escalation (default: 3). */
  max_reworks: number;
  /** Arbitrary JSONB metadata (e.g., evidence, agent notes). */
  metadata: Record<string, unknown>;
  /** `ticket_id` of the parent ticket if this is a spawned subtask. */
  parent_id: string | null;
  /** Path to the TODO task file that generated this ticket. */
  source_task_file: string | null;
  /** ISO 8601 creation timestamp. */
  created_at: string;
  /** ISO 8601 last-modified timestamp. */
  updated_at: string;
  /** ISO 8601 completion timestamp. `null` until ticket reaches `DONE`. */
  completed_at: string | null;
}

/**
 * Audit event entity matching the `events` database table.
 *
 * Every state mutation in the system produces a `TicketEvent` row. These
 * events form an immutable audit log for compliance, debugging, and the
 * real-time SSE dashboard feed.
 */
export interface TicketEvent {
  /** UUID primary key. */
  id: string;
  /** The ticket this event relates to. */
  ticket_id: string;
  /** Category of the state change. */
  event_type: EventType;
  /** UUID of the agent that triggered the event. */
  agent_id: string | null;
  /** Human-readable agent name. */
  agent_name: string | null;
  /** Hostname of the machine that triggered the event. */
  machine_id: string | null;
  /** Human operator who initiated the action. */
  operator: string | null;
  /** SDLC stage before the transition (`null` for non-stage events). */
  previous_stage: TicketStage | null;
  /** SDLC stage after the transition (`null` for non-stage events). */
  new_stage: TicketStage | null;
  /** Ticket status before the change (`null` for non-status events). */
  previous_status: TicketStatus | null;
  /** Ticket status after the change (`null` for non-status events). */
  new_status: TicketStatus | null;
  /** Arbitrary JSONB data attached to the event (e.g., rejection reason). */
  payload: Record<string, unknown>;
  /** ISO 8601 timestamp when the event was recorded. */
  created_at: string;
}

/**
 * Agent entity matching the `agents` database table.
 *
 * Represents a registered agent (e.g., Backend Engineer, QA Engineer) that
 * can authenticate via API key and claim tickets.
 */
export interface Agent {
  /** UUID primary key. */
  id: string;
  /** Unique agent name (e.g., `"Backend Engineer"`). */
  name: string;
  /** Agent role used for stage ownership validation. */
  role: string;
  /** bcrypt hash of the agent's API key. `null` if key not yet provisioned. */
  api_key_hash: string | null;
  /**
   * Permission strings granted to this agent.
   *
   * @remarks
   * Typed as `string[]` to support the admin wildcard `"*"`. A stricter
   * `Permission` union type could be introduced for compile-time safety.
   */
  permissions: string[];
  /** Default machine this agent operates from. */
  machine_id: string | null;
  /** Whether the agent is currently enabled. Revoked agents cannot authenticate. */
  is_active: boolean;
  /** ISO 8601 timestamp when the agent's access was revoked. `null` if active. */
  revoked_at: string | null;
  /** ISO 8601 creation timestamp. */
  created_at: string;
  /** ISO 8601 last-modified timestamp. */
  updated_at: string;
}

/**
 * Session entity matching the `sessions` database table.
 *
 * Tracks active agent sessions. Each session binds an agent to a machine
 * and operator, enabling lease validation and audit attribution.
 */
export interface Session {
  /** UUID primary key. */
  id: string;
  /** FK to the `agents` table. */
  agent_id: string;
  /** Opaque session token used for bearer authentication. */
  session_token: string;
  /** Hostname of the machine this session was created from. */
  machine_id: string;
  /** Human operator who started the session. */
  operator: string | null;
  /** IP address of the connecting client. */
  ip_address: string | null;
  /** ISO 8601 timestamp of the last API call in this session. */
  last_seen: string;
  /** ISO 8601 timestamp when this session expires. */
  expires_at: string;
  /** ISO 8601 creation timestamp. */
  created_at: string;
}

/**
 * File lock entity matching the `file_locks` database table.
 *
 * Prevents concurrent modification of the same file by multiple agents.
 * When an agent claims a ticket, locks are acquired for all paths in
 * the ticket's `file_paths` array.
 */
export interface FileLock {
  /** UUID primary key. */
  id: string;
  /** Workspace-relative path of the locked file. */
  file_path: string;
  /** The ticket that holds this lock. */
  ticket_id: string;
  /** UUID of the agent holding the lock. */
  locked_by: string | null;
  /** Hostname of the machine holding the lock. */
  machine_id: string | null;
  /** ISO 8601 timestamp when the lock was acquired. */
  locked_at: string;
  /** ISO 8601 timestamp when the lock was released. `null` if still held. */
  released_at: string | null;
}

/**
 * Project entity matching the `projects` database table.
 *
 * Groups tickets under a repository and provides project-level defaults
 * for lease durations.
 */
export interface Project {
  /** UUID primary key. */
  id: string;
  /** Unique project name. */
  name: string;
  /** Optional project description. */
  description: string | null;
  /** Git repository URL associated with this project. */
  repo_url: string | null;
  /** Default lease duration (minutes) for tickets in this project. */
  default_lease_minutes: number;
  /** Maximum allowed lease extension (minutes). */
  max_lease_minutes: number;
  /** ISO 8601 creation timestamp. */
  created_at: string;
  /** ISO 8601 last-modified timestamp. */
  updated_at: string;
}

// ── MCP Tool Input/Output Types ──

/**
 * Input parameters for the `tickets.next` MCP tool.
 *
 * Retrieves the next available (unclaimed, `READY`-status) ticket matching
 * the given stage and optional filters. Tickets are returned in priority
 * order (critical first).
 */
export interface TicketsNextInput {
  /** The SDLC stage to search for available tickets. */
  stage: TicketStage;
  /** Optional filter by ticket type. */
  type?: TicketType;
  /** Optional filter by minimum priority. */
  priority?: TicketPriority;
}

/**
 * Output from the `tickets.next` MCP tool.
 *
 * Returns the highest-priority unclaimed ticket, or `null` if none are available.
 */
export interface TicketsNextOutput {
  /** The next available ticket, or `null` if the queue is empty. */
  ticket: Ticket | null;
  /** Human-readable status message. */
  message: string;
}

/**
 * Input parameters for the `tickets.claim` MCP tool.
 *
 * Claims a ticket for an agent, acquiring file locks and setting lease expiry.
 * This is the programmatic equivalent of the CLAIM commit in the two-commit
 * protocol.
 */
export interface TicketsClaimInput {
  /** The `ticket_id` of the ticket to claim. */
  ticket_id: string;
  /** Name of the agent claiming the ticket. */
  agent_name: string;
  /** Hostname of the machine the agent is running on. */
  machine_id: string;
  /** Human operator who initiated the claim. */
  operator?: string;
  /** Custom lease duration in minutes (overrides project default). */
  lease_minutes?: number;
}

/**
 * Output from the `tickets.claim` MCP tool.
 *
 * Confirms the claim and returns the updated ticket, lease expiry, and
 * any file locks that were acquired.
 */
export interface TicketsClaimOutput {
  /** The claimed ticket with updated status and metadata. */
  ticket: Ticket;
  /** ISO 8601 timestamp when the lease expires. */
  lease_expiry: string;
  /** Array of file paths that were locked for this ticket. */
  file_locks: string[];
}

/**
 * Input parameters for the `tickets.update` MCP tool.
 *
 * Updates arbitrary metadata on a claimed ticket. The agent must own
 * the claim to perform updates.
 */
export interface TicketsUpdateInput {
  /** The `ticket_id` of the ticket to update. */
  ticket_id: string;
  /** Key-value metadata to merge into the ticket's `metadata` JSONB field. */
  metadata: Record<string, unknown>;
}

/**
 * Output from the `tickets.update` MCP tool.
 */
export interface TicketsUpdateOutput {
  /** The ticket with updated metadata. */
  ticket: Ticket;
}

/**
 * Input parameters for the `tickets.complete` MCP tool.
 *
 * Marks the current SDLC stage as complete and advances the ticket to
 * the next stage. Requires evidence documenting what was accomplished.
 */
export interface TicketsCompleteInput {
  /** The `ticket_id` of the ticket to complete. */
  ticket_id: string;
  /**
   * Evidence proving the stage's work is done.
   *
   * @remarks
   * This structure enforces the system's evidence rule: every completion
   * claim must include artifact paths, test results, and a confidence level.
   */
  evidence: {
    /** Workspace-relative paths of files created or modified. */
    artifacts: string[];
    /** Summary of test results or `"N/A"` with justification. */
    test_results: string;
    /** Agent's self-assessed confidence in the deliverable. */
    confidence: 'HIGH' | 'MEDIUM' | 'LOW';
    /** Optional free-text notes. */
    notes?: string;
  };
}

/**
 * Output from the `tickets.complete` MCP tool.
 *
 * Confirms the stage transition and reports any downstream tickets that
 * were unblocked as a result.
 */
export interface TicketsCompleteOutput {
  /** The ticket in its new stage. */
  ticket: Ticket;
  /** The stage the ticket just left. */
  previous_stage: TicketStage;
  /** The stage the ticket advanced to. */
  new_stage: TicketStage;
  /** Array of `ticket_id` values whose dependencies are now fully resolved. */
  dependencies_unblocked: string[];
}

/**
 * Input parameters for the `tickets.reject` MCP tool.
 *
 * Sends a ticket back to its implementation stage for rework. If the
 * rework count reaches `max_reworks`, the ticket is escalated instead.
 */
export interface TicketsRejectInput {
  /** The `ticket_id` of the ticket to reject. */
  ticket_id: string;
  /** Human-readable explanation of why the ticket was rejected. */
  reason: string;
  /** Optional structured evidence supporting the rejection. */
  evidence?: Record<string, unknown>;
}

/**
 * Output from the `tickets.reject` MCP tool.
 */
export interface TicketsRejectOutput {
  /** The ticket with updated rework state. */
  ticket: Ticket;
  /** Updated rework count after this rejection. */
  rework_count: number;
  /** `true` if the ticket was escalated (rework limit reached). */
  escalated: boolean;
  /** The SDLC stage the ticket was returned to. */
  returned_to_stage: TicketStage;
}

/**
 * Input parameters for the `tickets.spawn` MCP tool.
 *
 * Creates a child ticket under an existing parent. The child inherits
 * the parent's project context and enters the SDLC flow for its own type.
 */
export interface TicketsSpawnInput {
  /** `ticket_id` of the parent ticket. */
  parent_id: string;
  /** Title for the new child ticket. */
  title: string;
  /** Classification type for the child (determines its SDLC flow). */
  type: TicketType;
  /** Priority for the child (defaults to parent's priority). */
  priority?: TicketPriority;
  /** Acceptance criteria the child must satisfy. */
  acceptance_criteria: string[];
  /** Workspace-relative file paths within the child's write scope. */
  file_paths: string[];
  /** Detailed description of the child ticket. */
  description?: string;
  /** Array of `ticket_id` values the child depends on. */
  depends_on?: string[];
}

/**
 * Output from the `tickets.spawn` MCP tool.
 */
export interface TicketsSpawnOutput {
  /** The newly created child ticket. */
  ticket: Ticket;
  /** `ticket_id` of the parent that spawned this child. */
  parent_ticket_id: string;
}

/**
 * Input parameters for the `tickets.graph` MCP tool.
 *
 * Retrieves the dependency graph for tickets, optionally filtered by
 * stage, type, or status.
 */
export interface TicketsGraphInput {
  /** Optional filters to narrow the graph. */
  filter?: {
    /** Filter nodes by SDLC stage. */
    stage?: TicketStage;
    /** Filter nodes by ticket type. */
    type?: TicketType;
    /** Filter nodes by operational status. */
    status?: TicketStatus;
  };
}

/**
 * Output from the `tickets.graph` MCP tool.
 *
 * Returns a directed acyclic graph (DAG) of ticket dependencies.
 */
export interface TicketsGraphOutput {
  /** Array of ticket nodes (serialized as generic records). */
  nodes: Array<Record<string, unknown>>;
  /** Dependency edges between tickets. */
  edges: Array<{ from: string; to: string }>;
  /** Total number of tickets in the filtered graph. */
  total_tickets: number;
}

/**
 * Input parameters for the `tickets.release` MCP tool.
 *
 * Releases a claim on a ticket, freeing it for other agents. An admin
 * can force-release tickets owned by other agents.
 */
export interface TicketsReleaseInput {
  /** The `ticket_id` of the ticket to release. */
  ticket_id: string;
  /** Optional reason for releasing the claim. */
  reason?: string;
  /** If `true`, release even if the caller is not the claim owner (admin only). */
  force?: boolean;
}

/**
 * Output from the `tickets.release` MCP tool.
 */
export interface TicketsReleaseOutput {
  /** The ticket with cleared claim fields. */
  ticket: Ticket;
  /** `true` if the release was successful. */
  released: boolean;
}

/**
 * Input parameters for the `tickets.extend` MCP tool.
 *
 * Extends the lease on a claimed ticket to prevent expiry during
 * long-running work.
 */
export interface TicketsExtendInput {
  /** The `ticket_id` whose lease to extend. */
  ticket_id: string;
  /** Additional minutes to add to the current lease (defaults to project setting). */
  duration_minutes?: number;
}

/**
 * Output from the `tickets.extend` MCP tool.
 */
export interface TicketsExtendOutput {
  /** The ticket with updated lease metadata. */
  ticket: Ticket;
  /** The new ISO 8601 lease expiry timestamp. */
  new_lease_expiry: string;
}

/**
 * Output from the `tickets.stats` MCP tool.
 *
 * Provides an aggregate dashboard view of the ticket system. Used by
 * the real-time dashboard and operator tooling.
 *
 * @remarks
 * This tool has no input parameters — it always returns system-wide statistics.
 */
export interface TicketsStatsOutput {
  /** Total number of tickets in the system. */
  total_tickets: number;
  /** Count of tickets grouped by SDLC stage. */
  by_stage: Record<string, number>;
  /** Count of tickets grouped by operational status. */
  by_status: Record<string, number>;
  /** Count of tickets grouped by classification type. */
  by_type: Record<string, number>;
  /** Rework metrics across all tickets. */
  rework_metrics: {
    /** Total number of rework events system-wide. */
    total_reworks: number;
    /** Average rework count per ticket. */
    avg_reworks: number;
    /** Highest rework count on any single ticket. */
    max_reworks: number;
  };
  /** Agents with currently claimed tickets. */
  active_agents: Array<{ agent: string; active_tickets: number }>;
  /** Number of tickets currently in `BLOCKED` status. */
  blocked_tickets: number;
  /** Most recent audit events for the activity feed. */
  recent_events: Array<{ event_type: string; ticket_id: string; created_at: string }>;
}

// ── Auth Types ──

/**
 * Authenticated agent identity extracted from the auth middleware.
 *
 * Populated by the `auth.ts` middleware after validating the bearer token
 * or API key. Available on every authenticated request.
 */
export interface AgentIdentity {
  /** UUID of the authenticated agent. */
  id: string;
  /** Agent name (e.g., `"Backend Engineer"`). */
  name: string;
  /** Agent role for stage-ownership checks. */
  role: string;
  /** Granted permissions (see {@link Agent.permissions}). */
  permissions: string[];
  /** Machine the agent is operating from. `null` if not bound. */
  machine_id: string | null;
}

// ── SSE Event Types ──

/**
 * Server-Sent Event payload pushed to dashboard clients.
 *
 * The dashboard subscribes to an SSE endpoint and receives these events
 * in real time for live ticket status, pipeline changes, and alerts.
 */
export interface SSETicketEvent {
  /**
   * Category of the SSE event.
   *
   * - `ticket-update` — A ticket's fields changed.
   * - `pipeline-change` — A ticket moved to a new SDLC stage.
   * - `claim-update` — A ticket was claimed or released.
   * - `system-alert` — System-level notification (e.g., escalation).
   */
  type: 'ticket-update' | 'pipeline-change' | 'claim-update' | 'system-alert';
  /** Event-specific data payload. */
  data: Record<string, unknown>;
  /** ISO 8601 timestamp when the event was emitted. */
  timestamp: string;
}

// ── Error Types ──

/**
 * ForgeOS structured error codes.
 *
 * Every error response from the MCP server includes one of these codes.
 * Codes map to specific failure conditions and allow clients to handle
 * errors programmatically.
 *
 * @remarks
 * The 14 codes cover the full error surface: ticket operations (6),
 * lease management (2), auth (2), rate limiting (1), invalid input (1),
 * and infrastructure (2).
 */
export enum ForgeOSErrorCode {
  /** The requested ticket does not exist. */
  TICKET_NOT_FOUND = 'TICKET_NOT_FOUND',
  /** The ticket is already claimed by another agent. */
  ALREADY_CLAIMED = 'ALREADY_CLAIMED',
  /** The caller does not own the claim on this ticket. */
  NOT_CLAIM_OWNER = 'NOT_CLAIM_OWNER',
  /** A file in the ticket's scope is locked by another ticket. */
  FILE_CONFLICT = 'FILE_CONFLICT',
  /** The requested stage transition violates the SDLC flow. */
  INVALID_TRANSITION = 'INVALID_TRANSITION',
  /** Completion was attempted without required evidence. */
  MISSING_EVIDENCE = 'MISSING_EVIDENCE',
  /** The spawned subtask violates parent constraints. */
  INVALID_SUBTASK = 'INVALID_SUBTASK',
  /** The agent's lease on the ticket has expired. */
  LEASE_EXPIRED = 'LEASE_EXPIRED',
  /** The requested lease duration exceeds the project maximum. */
  LEASE_TOO_LONG = 'LEASE_TOO_LONG',
  /** The agent has exceeded the API rate limit. */
  RATE_LIMITED = 'RATE_LIMITED',
  /** Authentication failed (missing or invalid credentials). */
  UNAUTHORIZED = 'UNAUTHORIZED',
  /** The agent lacks permission for this operation. */
  FORBIDDEN = 'FORBIDDEN',
  /** An unexpected internal error occurred. */
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  /** The PostgreSQL database is unreachable. */
  DB_UNAVAILABLE = 'DB_UNAVAILABLE',
}

/**
 * Structured error response returned by all MCP tool handlers on failure.
 *
 * Clients can switch on the `error` code for programmatic handling and
 * display the `message` for human-readable context.
 */
export interface ErrorResponse {
  /** Machine-readable error code from {@link ForgeOSErrorCode}. */
  error: ForgeOSErrorCode;
  /** Human-readable error description. */
  message: string;
  /** Optional additional context (e.g., conflicting file paths). */
  details?: Record<string, unknown>;
  /** The ticket involved in the error, if applicable. */
  ticket_id?: string;
  /** ISO 8601 timestamp when the error occurred. */
  timestamp: string;
}

// ── SDLC Flow Definitions ──

/**
 * SDLC flow mapping per ticket type.
 *
 * Defines the ordered sequence of {@link TicketStage} values each
 * {@link TicketType} must traverse. The `tickets.py` state machine and
 * MCP tool handlers enforce these flows — no stage may be skipped or
 * reordered.
 *
 * @example
 * ```typescript
 * const backendFlow = SDLC_FLOWS['backend'];
 * // ['READY', 'BACKEND', 'QA', 'SECURITY', 'CI', 'DOCUMENTATION', 'VALIDATOR', 'DONE']
 * ```
 */
export const SDLC_FLOWS: Record<TicketType, TicketStage[]> = {
  backend:      ['READY', 'BACKEND', 'QA', 'SECURITY', 'CI', 'DOCUMENTATION', 'VALIDATOR', 'DONE'],
  frontend:     ['READY', 'UI_DESIGN', 'FRONTEND', 'QA', 'SECURITY', 'CI', 'DOCUMENTATION', 'VALIDATOR', 'DONE'],
  fullstack:    ['READY', 'UI_DESIGN', 'BACKEND', 'FRONTEND', 'QA', 'SECURITY', 'CI', 'DOCUMENTATION', 'VALIDATOR', 'DONE'],
  infra:        ['READY', 'BACKEND', 'QA', 'SECURITY', 'CI', 'DOCUMENTATION', 'VALIDATOR', 'DONE'],
  security:     ['READY', 'SECURITY', 'QA', 'CI', 'DOCUMENTATION', 'VALIDATOR', 'DONE'],
  docs:         ['READY', 'DOCUMENTATION', 'VALIDATOR', 'DONE'],
  research:     ['READY', 'RESEARCH', 'DOCUMENTATION', 'VALIDATOR', 'DONE'],
  architecture: ['READY', 'ARCHITECT', 'DOCUMENTATION', 'VALIDATOR', 'DONE'],
  product:      ['READY', 'PRODUCT_MANAGER', 'DOCUMENTATION', 'VALIDATOR', 'DONE'],
  design:       ['READY', 'UI_DESIGN', 'DOCUMENTATION', 'VALIDATOR', 'DONE'],
};

/**
 * All valid ticket stages as an array.
 *
 * Used by Zod schemas for runtime validation of stage values received
 * from MCP tool inputs.
 */
export const TICKET_STAGES: TicketStage[] = [
  'READY', 'RESEARCH', 'ARCHITECT', 'PRODUCT_MANAGER', 'UI_DESIGN',
  'BACKEND', 'FRONTEND', 'QA', 'SECURITY', 'CI',
  'DOCUMENTATION', 'VALIDATOR', 'DONE',
];

/**
 * All valid ticket types as an array.
 *
 * Used by Zod schemas for runtime validation of type values.
 */
export const TICKET_TYPES: TicketType[] = [
  'backend', 'frontend', 'fullstack', 'infra', 'security',
  'docs', 'research', 'architecture', 'product', 'design',
];

/**
 * All valid ticket statuses as an array.
 *
 * Used by Zod schemas for runtime validation of status values.
 */
export const TICKET_STATUSES: TicketStatus[] = [
  'READY', 'BLOCKED', 'CLAIMED', 'IN_PROGRESS', 'DONE', 'FAILED', 'ESCALATED',
];

/**
 * All valid ticket priorities as an array.
 *
 * Used by Zod schemas for runtime validation of priority values.
 */
export const TICKET_PRIORITIES: TicketPriority[] = [
  'critical', 'high', 'medium', 'low',
];
