/**
 * Reflection Protocol Service — Automated lesson extraction from rework cycles.
 *
 * Auto-triggers on rework-to-DONE ticket transitions. Extracts lessons from
 * QA/Security/CI rejection cycles: what failed, what fixed it, and the
 * pattern learned. Generates embeddings via {@link EmbeddingService} and
 * stores structured lessons in the `lessons` / `lesson_embeddings` tables.
 *
 * Only processes tickets with `rework_count > 0`.
 *
 * @module services/reflection-service
 * @ticket TASK-INT-BE034
 */

import type { Pool } from 'pg';
import type { EmbeddingService } from './embedding-service.js';
import { logger } from '../middleware/logging.js';

// ── Public Types ─────────────────────────────────────────────────────────────

/** Structured lesson extracted from a rework cycle. */
export interface ReflectionLesson {
  ticketId: string;
  stage: string;
  agentRole: string;
  whatFailed: string;
  whatFixedIt: string;
  patternLearned: string;
  reworkCount: number;
}

/** Row shape for the ticket query. */
interface TicketRow {
  ticket_id: string;
  current_stage: string;
  claimed_by: string | null;
  rework_count: number;
}

/** Row shape for event queries. */
interface EventRow {
  id: string;
  ticket_id: string;
  event_type: string;
  payload: {
    reason?: string;
    evidence?: { notes?: string };
    [key: string]: unknown;
  };
  created_at: string;
}

/** Row shape for the lesson insert returning id. */
interface LessonInsertRow {
  id: string;
}

// ── Service ──────────────────────────────────────────────────────────────────

/**
 * Analyses rework cycles on completed tickets and persists structured
 * lessons with vector embeddings for future semantic retrieval.
 */
export class ReflectionService {
  constructor(
    private readonly pool: Pool,
    private readonly embeddingService: EmbeddingService,
  ) { }

  /**
   * Reflect on a ticket's rework history and extract a lesson.
   *
   * Returns `null` if the ticket does not exist or has never been reworked.
   *
   * @param ticketId - The ticket identifier to analyse.
   * @returns A structured lesson, or `null` if no rework occurred.
   */
  async reflectOnTicket(ticketId: string): Promise<ReflectionLesson | null> {
    // 1. Load ticket — bail early if missing or never reworked
    const ticketResult = await this.pool.query<TicketRow>(
      'SELECT ticket_id, current_stage, claimed_by, rework_count FROM tickets WHERE ticket_id = $1',
      [ticketId],
    );
    const ticket = ticketResult.rows[0];
    if (!ticket || ticket.rework_count === 0) {
      logger.info({ ticketId }, 'reflection-service: skipping — no rework history');
      return null;
    }

    // 2. Fetch rejection events (STAGE_REJECTED) in chronological order
    const rejectionEvents = await this.pool.query<EventRow>(
      `SELECT id, ticket_id, event_type, payload, created_at
       FROM events
       WHERE ticket_id = $1 AND event_type = 'STAGE_REJECTED'
       ORDER BY created_at ASC`,
      [ticketId],
    );

    // 3. Fetch completion events (STAGE_ADVANCED) that followed rejections
    const completionEvents = await this.pool.query<EventRow>(
      `SELECT id, ticket_id, event_type, payload, created_at
       FROM events
       WHERE ticket_id = $1 AND event_type = 'STAGE_ADVANCED'
       ORDER BY created_at ASC`,
      [ticketId],
    );

    // 4. Extract lesson components
    const whatFailed = rejectionEvents.rows
      .map((e) => e.payload?.reason ?? 'unknown rejection')
      .join('; ');

    const lastCompletion = completionEvents.rows[completionEvents.rows.length - 1];
    const whatFixedIt =
      lastCompletion?.payload?.evidence?.notes ?? 'Fixed via rework';

    const patternLearned = `When ${whatFailed}, the fix was: ${whatFixedIt}`;

    // 5. Generate embedding
    const lessonText = `${whatFailed} | ${whatFixedIt} | ${patternLearned}`;
    const embedding = await this.embeddingService.embedText(lessonText);

    // 6. Store lesson + embedding in a single transaction
    const agentRole = ticket.claimed_by ?? 'unknown';
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const lessonResult = await client.query<LessonInsertRow>(
        `INSERT INTO lessons (ticket_id, stage, agent_role, lesson_text, category, tags, rework_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          ticketId,
          ticket.current_stage,
          agentRole,
          lessonText,
          'rework',
          ['auto-reflected'],
          ticket.rework_count,
        ],
      );

      const lessonRow = lessonResult.rows[0];
      if (!lessonRow) {
        throw new Error('lesson insert returned no rows');
      }
      const lessonId = lessonRow.id;

      await client.query(
        `INSERT INTO lesson_embeddings (lesson_id, embedding, model_name)
         VALUES ($1, $2, $3)`,
        [
          lessonId,
          JSON.stringify(embedding),
          process.env.EMBEDDING_MODEL ?? 'mxbai-embed-large',
        ],
      );

      await client.query('COMMIT');

      logger.info(
        { ticketId, lessonId, reworkCount: ticket.rework_count },
        'reflection-service: lesson persisted',
      );
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    return {
      ticketId,
      stage: ticket.current_stage,
      agentRole,
      whatFailed,
      whatFixedIt,
      patternLearned,
      reworkCount: ticket.rework_count,
    };
  }
}
