/**
 * GitHub Webhook Router — POST /api/webhooks/github.
 *
 * Accepts GitHub push event payloads, verifies HMAC-SHA256 signatures,
 * parses commit messages for ticket operations, and triggers state
 * reconciliation.
 *
 * The router uses `express.raw({ type: 'application/json' })` for body
 * parsing to preserve the original payload bytes needed for HMAC-SHA256
 * signature verification. Mount this router BEFORE any global
 * `express.json()` middleware, or as an Express sub-application.
 *
 * @module webhooks/github
 * @ticket TASK-FOS-06-004
 */

import crypto from 'node:crypto';
import express, { Router, type Request, type Response } from 'express';
import {
  parsePushEvent,
  parseCommitMessage,
  type GitHubPushEvent,
  type GitHubPushCommit,
  type TicketCommitOp,
} from './parser.js';
import {
  reconcileOperations,
  type DatabasePool,
  type StructuredLogger,
  type ReconciliationDeps,
} from './reconciliation.js';

// ── Types ────────────────────────────────────────────────────────────────────

/** Configuration for the GitHub webhook router factory. */
export interface WebhookRouterConfig {
  readonly webhookSecret: string;
  readonly pool: DatabasePool;
  readonly logger: StructuredLogger;
}

/** Recovery request body shape. */
interface RecoveryPayload {
  readonly commits: readonly GitHubPushCommit[];
  readonly last_known_sha?: string;
}

// ── Signature Verification ───────────────────────────────────────────────────

/**
 * Verify GitHub HMAC-SHA256 webhook signature.
 *
 * Computes HMAC-SHA256 of the payload using the shared secret and
 * compares against the provided signature using constant-time comparison
 * to prevent timing attacks.
 *
 * @param payload - Raw request body as a Buffer or string
 * @param signatureHeader - Value of the `X-Hub-Signature-256` header
 * @param secret - WEBHOOK_SECRET from environment configuration
 * @returns `true` if the signature is valid
 */
export function verifyWebhookSignature(
  payload: Buffer | string,
  signatureHeader: string,
  secret: string,
): boolean {
  const expected =
    'sha256=' +
    crypto.createHmac('sha256', secret).update(payload).digest('hex');

  if (expected.length !== signatureHeader.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(signatureHeader),
  );
}

// ── Private Helpers ──────────────────────────────────────────────────────────

/**
 * Extract the raw body bytes from the request for HMAC verification.
 *
 * Handles both scenarios:
 * - Router mounted with `express.raw()` — `req.body` is a Buffer
 * - Router mounted after `express.json()` — reconstruct from parsed body
 *
 * @param req - Express request object
 * @returns Raw body as a Buffer
 */
function extractRawBody(req: Request): Buffer {
  if (Buffer.isBuffer(req.body)) {
    return req.body;
  }
  return Buffer.from(JSON.stringify(req.body));
}

/**
 * Parse the request body as JSON, handling both Buffer and object forms.
 *
 * @param req - Express request object
 * @returns Parsed JSON object
 * @throws {SyntaxError} If the body cannot be parsed as JSON
 */
function parseBody<T>(req: Request): T {
  if (Buffer.isBuffer(req.body)) {
    return JSON.parse(req.body.toString('utf-8')) as T;
  }
  return req.body as T;
}

// ── Router Factory ───────────────────────────────────────────────────────────

/**
 * Create the GitHub webhook Express router.
 *
 * Routes:
 * - `POST /` — Accept push event payloads with HMAC-SHA256 verification
 * - `POST /recover` — Replay reconciliation from missed commits
 *
 * @param webhookConfig - Webhook secret, database pool, and logger
 * @returns Configured Express Router
 *
 * @example
 * ```typescript
 * import { createGitHubWebhookRouter } from './webhooks/github.js';
 *
 * const webhookRouter = createGitHubWebhookRouter({
 *   webhookSecret: config.WEBHOOK_SECRET,
 *   pool: getPool(),
 *   logger,
 * });
 * app.use('/api/webhooks/github', webhookRouter);
 * ```
 */
export function createGitHubWebhookRouter(
  webhookConfig: WebhookRouterConfig,
): Router {
  const router = Router();
  const { webhookSecret, pool, logger } = webhookConfig;

  // Raw body parser for HMAC signature verification
  router.use(express.raw({ type: 'application/json', limit: '1mb' }));

  // ── POST / — Push event handler ────────────────────────────────────────

  router.post('/', async (req: Request, res: Response) => {
    const requestId = req.requestId ?? 'unknown';

    logger.info(
      { requestId, path: req.path, operation: 'webhook_receive' },
      'GitHub webhook received',
    );

    // Step 1: Verify HMAC-SHA256 signature
    const signatureHeader = req.headers['x-hub-signature-256'];
    if (typeof signatureHeader !== 'string') {
      logger.warn(
        { requestId, operation: 'webhook_verify' },
        'Webhook rejected: missing X-Hub-Signature-256 header',
      );
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Missing X-Hub-Signature-256 header',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const rawBody = extractRawBody(req);
    if (!verifyWebhookSignature(rawBody, signatureHeader, webhookSecret)) {
      logger.warn(
        { requestId, operation: 'webhook_verify' },
        'Webhook rejected: invalid signature',
      );
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Invalid webhook signature',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Step 2: Parse JSON payload
    let payload: GitHubPushEvent;
    try {
      payload = parseBody<GitHubPushEvent>(req);
    } catch (parseErr: unknown) {
      const errMessage = parseErr instanceof Error ? parseErr.message : String(parseErr);
      logger.error(
        { requestId, error: errMessage, operation: 'webhook_parse' },
        'Webhook rejected: invalid JSON payload',
      );
      res.status(400).json({
        error: 'INVALID_PAYLOAD',
        message: 'Could not parse webhook payload as JSON',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Step 3: Validate push event shape
    if (!payload.ref || !payload.commits) {
      logger.info(
        { requestId, operation: 'webhook_skip' },
        'Webhook received non-push event, skipping',
      );
      res.status(200).json({
        status: 'skipped',
        message: 'Not a push event',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Step 4: Parse push event and extract operations
    const parsed = parsePushEvent(payload);
    logger.info(
      {
        requestId,
        branch: parsed.branch,
        repository: parsed.repository,
        commitCount: parsed.commits.length,
        operationCount: parsed.operations.length,
        operation: 'webhook_parsed',
      },
      'Push event parsed',
    );

    if (parsed.operations.length === 0) {
      logger.info(
        { requestId, branch: parsed.branch, operation: 'webhook_no_ops' },
        'No ticket operations found in push event',
      );
      res.status(200).json({
        status: 'ok',
        message: 'No ticket operations found',
        branch: parsed.branch,
        commits: parsed.commits.length,
        operations: 0,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Step 5: Reconcile operations with database state
    const deps: ReconciliationDeps = { pool, logger };
    try {
      const result = await reconcileOperations(parsed.operations, deps);

      logger.info(
        {
          requestId,
          branch: parsed.branch,
          claimsCreated: result.claimsCreated,
          ticketsAdvanced: result.ticketsAdvanced,
          ambiguousStates: result.ambiguousStates,
          operation: 'webhook_reconciled',
        },
        'Webhook reconciliation complete',
      );

      res.status(200).json({
        status: 'ok',
        branch: parsed.branch,
        commits: parsed.commits.length,
        operations: parsed.operations.length,
        reconciliation: {
          claims_created: result.claimsCreated,
          tickets_advanced: result.ticketsAdvanced,
          claims_released: result.claimsReleased,
          already_reconciled: result.alreadyReconciled,
          ambiguous_states: result.ambiguousStates,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (reconcileErr: unknown) {
      const errMessage =
        reconcileErr instanceof Error ? reconcileErr.message : String(reconcileErr);
      logger.error(
        { requestId, error: errMessage, operation: 'webhook_reconcile' },
        'Webhook reconciliation failed',
      );
      res.status(500).json({
        error: 'RECONCILIATION_ERROR',
        message: 'Reconciliation failed',
        timestamp: new Date().toISOString(),
      });
    }
  });

  // ── POST /recover — Replay missed webhook commits ──────────────────────

  router.post('/recover', async (req: Request, res: Response) => {
    const requestId = req.requestId ?? 'unknown';

    // Verify signature for recovery endpoint
    const signatureHeader = req.headers['x-hub-signature-256'];
    if (typeof signatureHeader !== 'string') {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Missing X-Hub-Signature-256 header',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const rawBody = extractRawBody(req);
    if (!verifyWebhookSignature(rawBody, signatureHeader, webhookSecret)) {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Invalid webhook signature',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Parse recovery payload
    let body: RecoveryPayload;
    try {
      body = parseBody<RecoveryPayload>(req);
    } catch {
      res.status(400).json({
        error: 'INVALID_PAYLOAD',
        message: 'Could not parse recovery payload',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (!body.commits || !Array.isArray(body.commits)) {
      res.status(400).json({
        error: 'INVALID_PAYLOAD',
        message: 'Recovery payload must include commits array',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Parse commit messages for ticket operations
    const operations: TicketCommitOp[] = [];
    for (const commit of body.commits) {
      const op = parseCommitMessage(commit.message, commit.id);
      if (op !== null) {
        operations.push(op);
      }
    }

    if (operations.length === 0) {
      res.status(200).json({
        status: 'ok',
        message: 'No ticket operations in recovery payload',
        last_known_sha: body.last_known_sha,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Reconcile recovered operations
    const deps: ReconciliationDeps = { pool, logger };
    try {
      const result = await reconcileOperations(operations, deps);

      logger.info(
        {
          requestId,
          lastKnownSha: body.last_known_sha,
          operationsProcessed: operations.length,
          operation: 'webhook_recovery',
        },
        'Webhook recovery reconciliation complete',
      );

      res.status(200).json({
        status: 'recovered',
        last_known_sha: body.last_known_sha,
        operations_processed: operations.length,
        reconciliation: {
          claims_created: result.claimsCreated,
          tickets_advanced: result.ticketsAdvanced,
          claims_released: result.claimsReleased,
          already_reconciled: result.alreadyReconciled,
          ambiguous_states: result.ambiguousStates,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (err: unknown) {
      const errMessage = err instanceof Error ? err.message : String(err);
      logger.error(
        { requestId, error: errMessage, operation: 'webhook_recovery' },
        'Webhook recovery failed',
      );
      res.status(500).json({
        error: 'RECOVERY_ERROR',
        message: 'Recovery reconciliation failed',
        timestamp: new Date().toISOString(),
      });
    }
  });

  return router;
}
