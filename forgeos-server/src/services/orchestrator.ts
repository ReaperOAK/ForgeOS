/**
 * ForgeOS Orchestrator Loop — Server-side dispatch coordinator.
 *
 * Polls the database for READY tickets on a configurable interval,
 * determines the correct agent from the ticket's current SDLC stage,
 * claims the ticket atomically via `claim_ticket_by_id`, and records
 * dispatch events. Designed for concurrent instances — double-claiming
 * is prevented by the database-level `SELECT FOR UPDATE SKIP LOCKED`.
 *
 * The orchestrator does NOT launch agents itself — that responsibility
 * belongs to the external runner. This is the server-side coordination
 * layer only.
 *
 * @module services/orchestrator
 * @ticket TASK-INT-BE015
 */

import type { Pool } from 'pg';
import { logger } from '../middleware/logging.js';
import type { TicketStage } from '../types/index.js';
import { EmbeddingService } from './embedding-service.js';

// ── Configuration ────────────────────────────────────────────────────────────

/**
 * Configuration for the orchestrator loop.
 *
 * @property pollIntervalMs  - Milliseconds between poll cycles (default 10 000).
 * @property machineName     - Hostname used in claim metadata.
 * @property operatorName    - Human operator recorded in claim metadata.
 * @property leaseMinutes    - Default lease duration for claimed tickets.
 */
export interface OrchestratorConfig {
  pollIntervalMs: number;
  machineName: string;
  operatorName: string;
  leaseMinutes: number;
}

// ── Stage → Agent Mapping ────────────────────────────────────────────────────

/**
 * Maps each SDLC implementation/review stage to the agent name that
 * processes it. Only stages where work is performed are included —
 * `READY` and `DONE` are not mapped since they are system-managed.
 */
export const STAGE_TO_AGENT: Readonly<Record<string, string>> = {
  RESEARCH: 'Research',
  PRODUCT_MANAGER: 'ProductManager',
  ARCHITECT: 'Architect',
  BACKEND: 'Backend',
  FRONTEND: 'Frontend',
  UI_DESIGN: 'UIDesigner',
  QA: 'QA',
  SECURITY: 'Security',
  CI: 'CIReviewer',
  DOCUMENTATION: 'Documentation',
  VALIDATOR: 'Validator',
};

// ── Orchestrator ─────────────────────────────────────────────────────────────

/** Row shape returned by the READY-ticket query. */
interface ReadyTicketRow {
  ticket_id: string;
  stage: TicketStage;
  priority: string;
}

/** Row shape returned by search_similar_lessons(). */
interface LessonRow {
  ticket_id: string;
  lesson_text: string;
  category: string;
  similarity: number;
}

/** A prior lesson injected into the agent delegation payload. */
export interface PriorLesson {
  title: string;
  content: string;
  category: string;
  confidence: string;
  similarity_score: number;
}

/**
 * Persistent orchestrator loop that polls for and dispatches READY tickets.
 *
 * Lifecycle:
 * 1. `start()` — begins polling immediately, then repeats every `pollIntervalMs`.
 * 2. `stop()`  — cancels the timer and drains the current poll cycle.
 *
 * Concurrent safety: multiple orchestrator instances may run simultaneously.
 * The `claim_ticket_by_id` stored function uses row-level locking so only
 * one instance wins the claim for any given ticket.
 */
export class ForgeOSOrchestrator {
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pollPromise: Promise<void> | null = null;

  constructor(
    private readonly pool: Pool,
    private readonly config: OrchestratorConfig,
  ) {}

  /** Whether the orchestrator loop is currently active. */
  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Start the orchestrator loop.
   *
   * Triggers an immediate first poll, then schedules subsequent polls
   * at the configured interval. Calling `start()` while already running
   * is a no-op.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    logger.info(
      { pollIntervalMs: this.config.pollIntervalMs, machine: this.config.machineName },
      'Orchestrator started',
    );
    this.schedulePoll(0); // immediate first poll
  }

  /**
   * Gracefully stop the orchestrator loop.
   *
   * Cancels the pending timer and waits for any in-flight poll cycle
   * to complete before returning. Safe to call multiple times.
   */
  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pollPromise) {
      await this.pollPromise;
      this.pollPromise = null;
    }
    logger.info('Orchestrator stopped');
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  /** Schedule the next poll cycle. First call polls immediately (delay=0). */
  private schedulePoll(delay?: number): void {
    if (!this.running) return;
    const ms = delay ?? this.config.pollIntervalMs;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.pollPromise = this.poll().finally(() => {
        this.pollPromise = null;
        this.schedulePoll();
      });
    }, ms);
  }

  /**
   * Execute a single poll cycle: find READY tickets, claim each one.
   *
   * Errors during the overall query log a warning and exit cleanly —
   * the next cycle will retry. Errors during individual ticket claims
   * are expected (race condition with another instance) and silently
   * skipped.
   */
  private async poll(): Promise<void> {
    if (!this.running) return;

    let rows: ReadyTicketRow[];
    try {
      const result = await this.pool.query<ReadyTicketRow>(
        `SELECT ticket_id, stage, priority
         FROM tickets
         WHERE status = 'READY'
           AND (claimed_by IS NULL OR lease_expiry < NOW())
         ORDER BY
           CASE priority
             WHEN 'critical' THEN 0
             WHEN 'high' THEN 1
             WHEN 'medium' THEN 2
             WHEN 'low' THEN 3
             ELSE 4
           END ASC,
           created_at ASC`,
      );
      rows = result.rows;
    } catch (err: unknown) {
      logger.warn({ err }, 'Orchestrator poll: failed to query READY tickets');
      return;
    }

    if (rows.length === 0) return;

    logger.debug({ count: rows.length }, 'Orchestrator poll: found READY tickets');

    for (const ticket of rows) {
      if (!this.running) break;

      const agent = STAGE_TO_AGENT[ticket.stage];
      if (!agent) {
        logger.warn(
          { ticketId: ticket.ticket_id, stage: ticket.stage },
          'Orchestrator: no agent mapped for stage, skipping',
        );
        continue;
      }

      await this.claimAndDispatch(ticket.ticket_id, agent);
    }
  }

  /**
   * Attempt to claim a single ticket and record the dispatch event.
   *
   * Uses the `claim_ticket_by_id` stored function for atomicity.
   * If the claim fails (another instance won the race), the error
   * is logged at debug level and the ticket is skipped.
   *
   * Before recording the dispatch event, injects prior lessons from
   * the memory engine into the delegation payload.
   */
  private async claimAndDispatch(ticketId: string, agentName: string): Promise<void> {
    try {
      // Resolve agent UUID (auto-register if missing)
      const agentRow = await this.pool.query<{ id: string }>(
        `INSERT INTO agents (name, role, permissions)
         VALUES ($1, $1, '["*"]'::JSONB)
         ON CONFLICT (name, role) DO UPDATE SET updated_at = NOW()
         RETURNING id`,
        [agentName],
      );
      const agentId: string = agentRow.rows[0]!.id;

      // Atomic claim via stored function
      const claimResult = await this.pool.query(
        'SELECT * FROM claim_ticket_by_id($1, $2, $3, $4, $5, $6)',
        [
          ticketId,
          agentId,
          agentName,
          this.config.machineName,
          this.config.operatorName,
          this.config.leaseMinutes,
        ],
      );

      if (claimResult.rows.length === 0) {
        logger.debug(
          { ticketId, agent: agentName },
          'Orchestrator: ticket no longer claimable (race lost)',
        );
        return;
      }

      // Inject memory: fetch prior lessons relevant to this ticket
      const priorLessons = await this.injectMemory(ticketId);

      // Record dispatch event with prior_lessons in payload
      await this.pool.query(
        `INSERT INTO events (ticket_id, event_type, agent_id, agent_name, machine_id, operator, payload)
         VALUES ($1, 'CLAIMED', $2, $3, $4, $5, $6)`,
        [
          ticketId,
          agentId,
          agentName,
          this.config.machineName,
          this.config.operatorName,
          JSON.stringify({
            source: 'orchestrator',
            action: 'dispatch',
            prior_lessons: priorLessons,
          }),
        ],
      );

      logger.info(
        { ticketId, agent: agentName, machine: this.config.machineName, lessonCount: priorLessons.length },
        'Orchestrator: ticket claimed and dispatched',
      );
    } catch (err: unknown) {
      // Expected when another orchestrator instance claimed first
      logger.debug(
        { ticketId, agent: agentName, err },
        'Orchestrator: claim failed (likely race condition)',
      );
    }
  }

  /**
   * Query prior lessons from the memory engine for a ticket.
   *
   * Generates an embedding for the ticket's title + description, then
   * searches for semantically similar lessons via `search_similar_lessons`.
   * Returns the top 5 lessons with similarity >= 0.7.
   *
   * Graceful degradation: returns an empty array if the embedding service
   * is unavailable or any error occurs during the lookup.
   */
  async injectMemory(ticketId: string): Promise<PriorLesson[]> {
    try {
      // Fetch ticket title + description for embedding context
      const ticketResult = await this.pool.query<{ title: string; description: string; ticket_type: string }>(
        'SELECT title, description, ticket_type FROM tickets WHERE ticket_id = $1',
        [ticketId],
      );
      const ticket = ticketResult.rows[0];
      if (!ticket) {
        return [];
      }

      const embeddingService = new EmbeddingService();
      const queryText = `${ticket.title} ${ticket.description ?? ''}`.trim();
      if (!queryText) {
        return [];
      }

      const embedding = await embeddingService.embedText(queryText);
      const vectorLiteral = `[${embedding.join(',')}]`;

      const result = await this.pool.query<{ search_similar_lessons: LessonRow[] }>(
        'SELECT search_similar_lessons($1::vector, $2, $3, $4)',
        [vectorLiteral, ticket.ticket_type ?? null, 0.7, 5],
      );

      const rows = result.rows[0]?.search_similar_lessons ?? [];
      return rows.map((row) => ({
        title: row.ticket_id,
        content: row.lesson_text,
        category: row.category,
        confidence: 'HIGH',
        similarity_score: row.similarity,
      }));
    } catch (err: unknown) {
      logger.warn(
        { ticketId, err },
        'Orchestrator: memory injection failed, proceeding without lessons',
      );
      return [];
    }
  }
}

// ── Factory ──────────────────────────────────────────────────────────────────

/** Default configuration values. */
const DEFAULTS: OrchestratorConfig = {
  pollIntervalMs: 10_000,
  machineName: 'unknown',
  operatorName: 'system',
  leaseMinutes: 30,
};

/**
 * Create a new orchestrator with sensible defaults.
 *
 * Merges caller-supplied overrides into the default configuration.
 *
 * @param pool   - PostgreSQL connection pool.
 * @param config - Partial configuration overrides.
 * @returns Configured {@link ForgeOSOrchestrator} instance (not yet started).
 */
export function createOrchestrator(
  pool: Pool,
  config: Partial<OrchestratorConfig> = {},
): ForgeOSOrchestrator {
  return new ForgeOSOrchestrator(pool, { ...DEFAULTS, ...config });
}
