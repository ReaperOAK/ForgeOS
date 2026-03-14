/**
 * Webhook State Reconciliation Engine.
 *
 * Compares Git state (from parsed push events) with database ticket state
 * and applies recovery rules for ghost commits:
 *
 * 1. Git CLAIM exists, DB has no claim → create claim in DB
 * 2. Git WORK complete, DB still CLAIMED → advance ticket in DB
 * 3. DB has claim but no Git commit and lease expired → release claim
 * 4. Ambiguous state → log warning, flag for admin
 *
 * All operations are idempotent — replaying the same webhook produces
 * the same final state. Every reconciliation action is recorded as a
 * RECONCILED event in the events table.
 *
 * @module webhooks/reconciliation
 * @ticket TASK-FOS-06-004
 */

import type { ClaimCommitOp, WorkCommitOp, TicketCommitOp } from './parser.js';
import { queueCompileTicketPrompt } from '../services/compiler.js';

// ── Dependency Interfaces ────────────────────────────────────────────────────

/**
 * Minimal database pool interface for dependency injection.
 *
 * Structurally compatible with `pg.Pool` — accepts the real pool at
 * runtime and a lightweight mock in tests.
 */
export interface DatabasePool {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}

/**
 * Minimal structured logger interface for dependency injection.
 *
 * Structurally compatible with pino's Logger.
 */
export interface StructuredLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
  debug(obj: Record<string, unknown>, msg: string): void;
}

/**
 * Injectable dependencies for the reconciliation engine.
 *
 * Inject via constructor/parameter for testability — depend on
 * abstractions (DatabasePool, StructuredLogger) not concretions.
 */
export interface ReconciliationDeps {
  readonly pool: DatabasePool;
  readonly logger: StructuredLogger;
}

// ── Result Types ─────────────────────────────────────────────────────────────

/** Action taken during a single reconciliation step. */
export type ReconciliationAction =
  | 'CLAIM_CREATED'
  | 'TICKET_ADVANCED'
  | 'CLAIM_RELEASED'
  | 'ALREADY_RECONCILED'
  | 'AMBIGUOUS';

/** Individual reconciliation event result. */
export interface ReconciliationEvent {
  readonly ticketId: string;
  readonly action: ReconciliationAction;
  readonly details: string;
  readonly commitSha: string;
}

/** Aggregate reconciliation result from processing multiple operations. */
export interface ReconciliationResult {
  readonly claimsCreated: number;
  readonly ticketsAdvanced: number;
  readonly claimsReleased: number;
  readonly alreadyReconciled: number;
  readonly ambiguousStates: number;
  readonly events: readonly ReconciliationEvent[];
}

// ── Internal Row Types ───────────────────────────────────────────────────────

/** Subset of ticket columns needed for reconciliation decisions. */
interface TicketRow {
  ticket_id: string;
  status: string;
  stage: string;
  claimed_by: string | null;
  claimed_by_name: string | null;
  machine_id: string | null;
  lease_expiry: string | null;
}

/** Agent lookup result. */
interface AgentRow {
  id: string;
}

/** Row returned by UPDATE ... RETURNING ticket_id. */
interface TicketIdRow {
  ticket_id: string;
}

// ── Private Helpers ──────────────────────────────────────────────────────────

/**
 * Record a reconciliation event in the events table.
 *
 * @param pool - Database connection pool
 * @param ticketId - Human-readable ticket identifier
 * @param commitSha - SHA of the triggering commit
 * @param action - Reconciliation action taken
 * @param details - Human-readable description
 */
async function recordReconciliationEvent(
  pool: DatabasePool,
  ticketId: string,
  commitSha: string,
  action: string,
  details: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO events (ticket_id, event_type, payload)
     VALUES ($1, 'RECONCILED', $2::jsonb)`,
    [
      ticketId,
      JSON.stringify({
        action,
        details,
        commitSha,
        reconciled_at: new Date().toISOString(),
      }),
    ],
  );
}

/**
 * Manually advance a ticket to its next SDLC stage.
 *
 * Used when the stored function `advance_ticket()` cannot be called
 * (e.g., agent UUID mismatch during reconciliation).
 *
 * @param pool - Database connection pool
 * @param ticketId - Human-readable ticket identifier
 * @param commitSha - SHA of the WORK commit triggering the advance
 */
async function manualAdvanceTicket(
  pool: DatabasePool,
  ticketId: string,
  commitSha: string,
): Promise<void> {
  await pool.query(
    `WITH current AS (
       SELECT ticket_id, stage, sdlc_flow,
              array_position(sdlc_flow, stage) AS current_idx
       FROM tickets WHERE ticket_id = $1
     )
     UPDATE tickets t SET
       stage = c.sdlc_flow[c.current_idx + 1],
       status = CASE
         WHEN c.sdlc_flow[c.current_idx + 1] = 'DONE' THEN 'DONE'::ticket_status
         ELSE 'READY'::ticket_status
       END,
       claimed_by = NULL,
       claimed_by_name = NULL,
       machine_id = NULL,
       operator = NULL,
       lease_expiry = NULL,
       completed_at = CASE
         WHEN c.sdlc_flow[c.current_idx + 1] = 'DONE' THEN NOW()
         ELSE NULL
       END,
       metadata = t.metadata || jsonb_build_object('reconciled', true, 'commit_sha', $2),
       updated_at = NOW()
     FROM current c
     WHERE t.ticket_id = c.ticket_id
       AND c.current_idx < array_length(c.sdlc_flow, 1)`,
    [ticketId, commitSha],
  );

  // Release file locks held by this ticket
  await pool.query(
    `UPDATE file_locks SET released_at = NOW()
     WHERE ticket_id = $1 AND released_at IS NULL`,
    [ticketId],
  );
}

// ── Public Reconciliation Functions ──────────────────────────────────────────

/**
 * Reconcile a single CLAIM operation from Git commits.
 *
 * Rule: If Git has a CLAIM commit but the DB has no active claim,
 * create the claim in the DB. Idempotent — already-claimed tickets
 * are silently skipped.
 *
 * @param op - Parsed CLAIM operation from a commit message
 * @param deps - Injectable dependencies (pool, logger)
 * @returns Reconciliation event describing the action taken
 */
export async function reconcileClaimOp(
  op: ClaimCommitOp,
  deps: ReconciliationDeps,
): Promise<ReconciliationEvent> {
  const { pool, logger } = deps;

  const ticketResult = await pool.query<TicketRow>(
    `SELECT ticket_id, status, stage, claimed_by, claimed_by_name,
            machine_id, lease_expiry
     FROM tickets WHERE ticket_id = $1`,
    [op.ticketId],
  );

  const ticket = ticketResult.rows[0];

  if (!ticket) {
    logger.warn(
      { ticketId: op.ticketId, commitSha: op.commitSha, operation: 'reconcile_claim' },
      'Reconciliation: ticket not found in database',
    );
    return {
      ticketId: op.ticketId,
      action: 'AMBIGUOUS',
      details: `Ticket ${op.ticketId} not found in database`,
      commitSha: op.commitSha,
    };
  }

  // Already claimed — idempotent skip
  if (ticket.status === 'CLAIMED' || ticket.status === 'IN_PROGRESS') {
    logger.debug(
      { ticketId: op.ticketId, status: ticket.status, operation: 'reconcile_claim' },
      'Reconciliation: ticket already claimed, skipping',
    );
    return {
      ticketId: op.ticketId,
      action: 'ALREADY_RECONCILED',
      details: `Ticket already in status ${ticket.status}`,
      commitSha: op.commitSha,
    };
  }

  // Terminal status — ambiguous
  if (ticket.status === 'DONE' || ticket.status === 'ESCALATED' || ticket.status === 'FAILED') {
    logger.warn(
      { ticketId: op.ticketId, status: ticket.status, commitSha: op.commitSha, operation: 'reconcile_claim' },
      'Reconciliation: CLAIM commit for terminal-status ticket',
    );
    await recordReconciliationEvent(
      pool, op.ticketId, op.commitSha, 'AMBIGUOUS',
      `CLAIM commit found for ticket in terminal status ${ticket.status}`,
    );
    return {
      ticketId: op.ticketId,
      action: 'AMBIGUOUS',
      details: `CLAIM commit for ticket in terminal status ${ticket.status}`,
      commitSha: op.commitSha,
    };
  }

  // Look up agent UUID for proper FK claim
  const agentResult = await pool.query<AgentRow>(
    'SELECT id FROM agents WHERE name = $1 LIMIT 1',
    [op.agent],
  );

  const agent = agentResult.rows[0];
  if (!agent) {
    logger.warn(
      { ticketId: op.ticketId, agentName: op.agent, commitSha: op.commitSha, operation: 'reconcile_claim' },
      'Reconciliation: agent not found in database, flagging as ambiguous',
    );
    await recordReconciliationEvent(
      pool, op.ticketId, op.commitSha, 'AMBIGUOUS',
      `Agent "${op.agent}" not found in agents table`,
    );
    return {
      ticketId: op.ticketId,
      action: 'AMBIGUOUS',
      details: `Agent "${op.agent}" not found in agents table`,
      commitSha: op.commitSha,
    };
  }

  // Create claim — conditional UPDATE ensures idempotency
  const updateResult = await pool.query<TicketIdRow>(
    `UPDATE tickets SET
       status = 'CLAIMED',
       claimed_by = $2,
       claimed_by_name = $3,
       machine_id = $4,
       operator = $5,
       lease_expiry = NOW() + INTERVAL '30 minutes',
       updated_at = NOW()
     WHERE ticket_id = $1 AND status = 'READY'
     RETURNING ticket_id`,
    [op.ticketId, agent.id, op.agent, op.machine, op.operator],
  );

  const updated = updateResult.rows[0];
  if (!updated) {
    // Race condition: ticket was claimed between SELECT and UPDATE
    logger.debug(
      { ticketId: op.ticketId, operation: 'reconcile_claim' },
      'Reconciliation: ticket no longer READY, skipping claim creation',
    );
    return {
      ticketId: op.ticketId,
      action: 'ALREADY_RECONCILED',
      details: 'Ticket no longer in READY status during claim creation',
      commitSha: op.commitSha,
    };
  }

  await recordReconciliationEvent(
    pool, op.ticketId, op.commitSha, 'CLAIM_CREATED',
    `Reconciled CLAIM for ${op.agent} on ${op.machine}`,
  );

  logger.info(
    {
      ticketId: op.ticketId,
      agent: op.agent,
      machine: op.machine,
      commitSha: op.commitSha,
      operation: 'reconcile_claim',
    },
    'Reconciliation: created claim from Git commit',
  );

  return {
    ticketId: op.ticketId,
    action: 'CLAIM_CREATED',
    details: `Created claim for ${op.agent} on ${op.machine}`,
    commitSha: op.commitSha,
  };
}

/**
 * Reconcile a single WORK completion operation from Git commits.
 *
 * Rule: If Git has a WORK complete commit but the DB ticket is still
 * in CLAIMED status at the reported stage, advance the ticket.
 * Idempotent — already-advanced tickets are silently skipped.
 *
 * @param op - Parsed WORK operation from a commit message
 * @param deps - Injectable dependencies (pool, logger)
 * @returns Reconciliation event describing the action taken
 */
export async function reconcileWorkOp(
  op: WorkCommitOp,
  deps: ReconciliationDeps,
): Promise<ReconciliationEvent> {
  const { pool, logger } = deps;

  const ticketResult = await pool.query<TicketRow>(
    `SELECT ticket_id, status, stage, claimed_by, claimed_by_name,
            machine_id, lease_expiry
     FROM tickets WHERE ticket_id = $1`,
    [op.ticketId],
  );

  const ticket = ticketResult.rows[0];

  if (!ticket) {
    logger.warn(
      { ticketId: op.ticketId, commitSha: op.commitSha, operation: 'reconcile_work' },
      'Reconciliation: ticket not found in database',
    );
    return {
      ticketId: op.ticketId,
      action: 'AMBIGUOUS',
      details: `Ticket ${op.ticketId} not found in database`,
      commitSha: op.commitSha,
    };
  }

  // Already completed — idempotent
  if (ticket.status === 'DONE') {
    logger.debug(
      { ticketId: op.ticketId, stage: ticket.stage, operation: 'reconcile_work' },
      'Reconciliation: ticket already DONE, skipping',
    );
    return {
      ticketId: op.ticketId,
      action: 'ALREADY_RECONCILED',
      details: 'Ticket already completed',
      commitSha: op.commitSha,
    };
  }

  // Stage mismatch — likely already advanced past the reported stage
  if (ticket.stage !== op.stage) {
    logger.debug(
      {
        ticketId: op.ticketId,
        currentStage: ticket.stage,
        reportedStage: op.stage,
        operation: 'reconcile_work',
      },
      'Reconciliation: stage mismatch, likely already advanced',
    );
    return {
      ticketId: op.ticketId,
      action: 'ALREADY_RECONCILED',
      details: `Ticket at stage ${ticket.stage}, WORK commit reports stage ${op.stage}`,
      commitSha: op.commitSha,
    };
  }

  // Ticket is at the correct stage and claimed — advance it
  if (ticket.status === 'CLAIMED' || ticket.status === 'IN_PROGRESS') {
    const agentResult = await pool.query<AgentRow>(
      'SELECT id FROM agents WHERE name = $1 LIMIT 1',
      [op.agent],
    );

    const agent = agentResult.rows[0];
    let advanced = false;

    if (agent) {
      try {
        await pool.query(
          'SELECT * FROM advance_ticket($1, $2, $3, $4::jsonb)',
          [
            op.ticketId,
            agent.id,
            op.agent,
            JSON.stringify({ reconciled: true, commitSha: op.commitSha }),
          ],
        );
        advanced = true;
      } catch (advanceErr: unknown) {
        const errMessage = advanceErr instanceof Error ? advanceErr.message : String(advanceErr);
        logger.warn(
          { ticketId: op.ticketId, error: errMessage, operation: 'reconcile_work' },
          'Reconciliation: advance_ticket failed, attempting manual advance',
        );
      }
    }

    if (!advanced) {
      await manualAdvanceTicket(pool, op.ticketId, op.commitSha);
    }

    await recordReconciliationEvent(
      pool, op.ticketId, op.commitSha, 'TICKET_ADVANCED',
      `Reconciled WORK completion at stage ${op.stage} by ${op.agent}`,
    );

    logger.info(
      {
        ticketId: op.ticketId,
        stage: op.stage,
        agent: op.agent,
        commitSha: op.commitSha,
        operation: 'reconcile_work',
      },
      'Reconciliation: advanced ticket from Git commit',
    );

    return {
      ticketId: op.ticketId,
      action: 'TICKET_ADVANCED',
      details: `Advanced from stage ${op.stage} based on WORK commit`,
      commitSha: op.commitSha,
    };
  }

  // Ticket is READY or BLOCKED but has a WORK commit — ambiguous
  logger.warn(
    {
      ticketId: op.ticketId,
      status: ticket.status,
      stage: ticket.stage,
      commitSha: op.commitSha,
      operation: 'reconcile_work',
    },
    'Reconciliation: WORK commit for unclaimed ticket, flagging as ambiguous',
  );
  await recordReconciliationEvent(
    pool, op.ticketId, op.commitSha, 'AMBIGUOUS',
    `WORK commit for ticket in status ${ticket.status}`,
  );
  return {
    ticketId: op.ticketId,
    action: 'AMBIGUOUS',
    details: `WORK commit for ticket in status ${ticket.status}`,
    commitSha: op.commitSha,
  };
}

/**
 * Reconcile multiple ticket operations from a push event.
 *
 * Processes each operation sequentially, collecting results.
 * All operations are idempotent — replaying produces the same result.
 *
 * @param operations - Array of parsed ticket operations
 * @param deps - Injectable dependencies (pool, logger)
 * @returns Aggregate reconciliation result
 */
export async function reconcileOperations(
  operations: readonly TicketCommitOp[],
  deps: ReconciliationDeps,
): Promise<ReconciliationResult> {
  const events: ReconciliationEvent[] = [];
  let claimsCreated = 0;
  let ticketsAdvanced = 0;
  let claimsReleased = 0;
  let alreadyReconciled = 0;
  let ambiguousStates = 0;

  for (const op of operations) {
    const event: ReconciliationEvent = op.type === 'CLAIM'
      ? await reconcileClaimOp(op, deps)
      : await reconcileWorkOp(op, deps);

    events.push(event);

    switch (event.action) {
      case 'CLAIM_CREATED':
        claimsCreated++;
        break;
      case 'TICKET_ADVANCED':
        ticketsAdvanced++;
        break;
      case 'CLAIM_RELEASED':
        claimsReleased++;
        break;
      case 'ALREADY_RECONCILED':
        alreadyReconciled++;
        break;
      case 'AMBIGUOUS':
        ambiguousStates++;
        break;
    }
  }

  deps.logger.info(
    {
      claimsCreated,
      ticketsAdvanced,
      claimsReleased,
      alreadyReconciled,
      ambiguousStates,
      totalOperations: operations.length,
      operation: 'reconcile_operations',
    },
    'Reconciliation batch complete',
  );

  return {
    claimsCreated,
    ticketsAdvanced,
    claimsReleased,
    alreadyReconciled,
    ambiguousStates,
    events,
  };
}

/**
 * Run periodic reconciliation sweep.
 *
 * Releases tickets with expired leases using the `release_expired_claims()`
 * stored function. Supplements the main webhook reconciliation flow with
 * time-based lease enforcement.
 *
 * @param deps - Injectable dependencies (pool, logger)
 * @returns Reconciliation result from the sweep
 */
export async function runPeriodicReconciliation(
  deps: ReconciliationDeps,
): Promise<ReconciliationResult> {
  const events: ReconciliationEvent[] = [];
  let claimsReleased = 0;

  const expiredResult = await deps.pool.query<{ released_count: number }>(
    'SELECT release_expired_claims() AS released_count',
  );
  const released = expiredResult.rows[0]?.released_count ?? 0;

  if (released > 0) {
    claimsReleased = released;
    deps.logger.info(
      { released, operation: 'periodic_reconciliation' },
      'Periodic reconciliation: released expired claims',
    );
  }

  return {
    claimsCreated: 0,
    ticketsAdvanced: 0,
    claimsReleased,
    alreadyReconciled: 0,
    ambiguousStates: 0,
    events,
  };
}

/**
 * Trigger prompt precompilation when a ticket transitions into READY state.
 *
 * Fire-and-forget by design to avoid blocking ticket lifecycle operations.
 */
export function handleTicketTransition(
  ticketId: string,
  newStage: string,
  newStatus: string,
): void {
  if (newStatus === 'READY') {
    queueCompileTicketPrompt(ticketId, `transition:${newStage}:${newStatus}`);
  }
}
