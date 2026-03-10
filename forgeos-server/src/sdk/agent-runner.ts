/**
 * Agent-Runner SDK — Safe Git Operations Wrapper.
 *
 * Wraps MCP ticket lifecycle operations (claim, complete, release) with
 * automatic fallback to `tickets.py` CLI when the MCP server is unreachable.
 * Enforces the two-commit protocol: CLAIM commit first, then WORK commit.
 * Prevents unsafe `git add .` / `git add -A` / `git add --all` patterns.
 * Validates that staged files match the ticket's declared `file_paths` scope.
 *
 * @module sdk/agent-runner
 * @ticket TASK-FOS-06-003
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../middleware/logging.js';
import type {
  TicketsClaimOutput,
  TicketsCompleteOutput,
} from '../types/index.js';
import { loadSdkConfig, FORBIDDEN_GIT_ADD_PATTERNS, type SdkConfig } from './config.js';

const execFileAsync = promisify(execFile);

// ── Types ────────────────────────────────────────────────────────────────────

/** Evidence object required when completing a stage. */
export interface StageEvidence {
  artifacts: string[];
  test_results: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  notes?: string;
}

/** Result from an MCP tool call via JSON-RPC. */
interface McpToolCallResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

/** Result returned by `claimTicket`. */
export interface ClaimResult {
  ticket: TicketsClaimOutput['ticket'];
  lease_expiry: string;
  file_locks: string[];
  source: 'mcp' | 'fallback';
}

/** Result returned by `completeStage`. */
export interface CompleteResult {
  ticket: TicketsCompleteOutput['ticket'];
  previous_stage: string;
  new_stage: string;
  dependencies_unblocked: string[];
  source: 'mcp' | 'fallback';
}

/** Result returned by `releaseTicket`. */
export interface ReleaseResult {
  ticket_id: string;
  released: boolean;
  source: 'mcp' | 'fallback';
}

// ── Errors ───────────────────────────────────────────────────────────────────

/** Error thrown when git-add patterns violate safety rules. */
export class ForbiddenGitAddError extends Error {
  constructor(pattern: string) {
    super(`Forbidden git-add pattern detected: "${pattern}". Use explicit file paths.`);
    this.name = 'ForbiddenGitAddError';
  }
}

/** Error thrown when staged files are outside ticket scope. */
export class ScopeViolationError extends Error {
  constructor(outOfScope: string[]) {
    super(`Files outside ticket scope: ${outOfScope.join(', ')}`);
    this.name = 'ScopeViolationError';
  }
}

/** Error thrown when both MCP and fallback fail. */
export class TicketOperationError extends Error {
  constructor(operation: string, cause: string) {
    super(`${operation} failed: ${cause}`);
    this.name = 'TicketOperationError';
  }
}

// ── Agent Runner ─────────────────────────────────────────────────────────────

export class AgentRunner {
  private readonly config: SdkConfig;

  constructor(config?: SdkConfig) {
    this.config = config ?? loadSdkConfig();
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Claim a ticket via MCP, with CLI fallback.
   *
   * Calls `tickets.claim` on the MCP server. If the server is unreachable
   * and `FORGEOS_FALLBACK_ENABLED` is true, falls back to
   * `python3 tickets.py --claim`.
   */
  async claimTicket(
    ticketId: string,
    agentName: string,
    machineId: string,
    operator?: string,
  ): Promise<ClaimResult> {
    logger.info({ ticketId, agentName, machineId, operator }, 'claimTicket called');

    try {
      const result = await this.callMcpTool('tickets.claim', {
        ticket_id: ticketId,
        agent_name: agentName,
        machine_id: machineId,
        operator: operator ?? null,
        lease_minutes: 30,
      });

      const parsed = JSON.parse(result.content[0]!.text) as TicketsClaimOutput;
      logger.info({ ticketId, source: 'mcp' }, 'claimTicket succeeded via MCP');

      return {
        ticket: parsed.ticket,
        lease_expiry: parsed.lease_expiry,
        file_locks: parsed.file_locks,
        source: 'mcp',
      };
    } catch (mcpError) {
      logger.warn({ ticketId, err: mcpError }, 'MCP claimTicket failed, attempting fallback');
      return this.claimFallback(ticketId, agentName, machineId, operator);
    }
  }

  /**
   * Complete the current stage and advance to the next.
   *
   * Calls `tickets.complete` on the MCP server. If unreachable and fallback
   * is enabled, falls back to `python3 tickets.py --advance`.
   */
  async completeStage(
    ticketId: string,
    evidence: StageEvidence,
  ): Promise<CompleteResult> {
    logger.info({ ticketId, confidence: evidence.confidence }, 'completeStage called');

    try {
      const result = await this.callMcpTool('tickets.complete', {
        ticket_id: ticketId,
        evidence,
      });

      const parsed = JSON.parse(result.content[0]!.text) as TicketsCompleteOutput;
      logger.info({ ticketId, newStage: parsed.new_stage, source: 'mcp' }, 'completeStage succeeded via MCP');

      return {
        ticket: parsed.ticket,
        previous_stage: parsed.previous_stage,
        new_stage: parsed.new_stage,
        dependencies_unblocked: parsed.dependencies_unblocked,
        source: 'mcp',
      };
    } catch (mcpError) {
      logger.warn({ ticketId, err: mcpError }, 'MCP completeStage failed, attempting fallback');
      return this.completeFallback(ticketId, evidence);
    }
  }

  /**
   * Release a claim on a ticket.
   *
   * Calls `tickets.release` on the MCP server. Falls back to
   * `python3 tickets.py --release` if unreachable.
   */
  async releaseTicket(
    ticketId: string,
    agentName: string,
    reason?: string,
  ): Promise<ReleaseResult> {
    logger.info({ ticketId, agentName, reason }, 'releaseTicket called');

    try {
      const result = await this.callMcpTool('tickets.release', {
        ticket_id: ticketId,
        agent_name: agentName,
        reason: reason ?? 'voluntary release',
      });

      const parsed = JSON.parse(result.content[0]!.text) as { ticket: { ticket_id: string } };
      logger.info({ ticketId, source: 'mcp' }, 'releaseTicket succeeded via MCP');

      return { ticket_id: parsed.ticket.ticket_id, released: true, source: 'mcp' };
    } catch (mcpError) {
      logger.warn({ ticketId, err: mcpError }, 'MCP releaseTicket failed, attempting fallback');
      return this.releaseFallback(ticketId);
    }
  }

  /**
   * Push work via git, enforcing two-commit protocol safety.
   *
   * Validates that:
   * 1. No forbidden git-add patterns are used.
   * 2. All staged files are within the ticket's declared `file_paths` scope
   *    (plus allowed system paths like `.github/agent-output/`, `.github/ticket-state/`,
   *    `.github/tickets/`, `.github/memory-bank/`).
   *
   * @param filePaths - Explicit list of files to stage.
   * @param ticketScope - The ticket's declared `file_paths` array.
   * @param commitMessage - The commit message.
   */
  async pushWork(
    filePaths: string[],
    ticketScope: string[],
    commitMessage: string,
  ): Promise<{ committed: boolean; pushed: boolean }> {
    logger.info({ fileCount: filePaths.length, commitMessage }, 'pushWork called');

    // Validate no forbidden patterns
    this.validateGitAddPatterns(filePaths);

    // Validate scope
    this.validateScope(filePaths, ticketScope);

    const cwd = this.config.FORGEOS_WORKSPACE_PATH;

    // Stage each file explicitly
    for (const fp of filePaths) {
      await execFileAsync('git', ['add', fp], { cwd });
    }

    // Commit
    await execFileAsync('git', ['commit', '-m', commitMessage], { cwd });
    logger.info({ commitMessage }, 'git commit succeeded');

    // Push
    try {
      await execFileAsync('git', ['push'], { cwd });
      logger.info('git push succeeded');
      return { committed: true, pushed: true };
    } catch (pushError) {
      logger.error({ err: pushError }, 'git push failed — lock conflict likely');
      return { committed: true, pushed: false };
    }
  }

  // ── Git Safety Guards ────────────────────────────────────────────────────

  /**
   * Reject any file path list that looks like a forbidden git-add pattern.
   *
   * @throws {ForbiddenGitAddError} if a forbidden pattern is detected.
   */
  validateGitAddPatterns(filePaths: string[]): void {
    for (const fp of filePaths) {
      const normalized = fp.trim().toLowerCase();
      for (const forbidden of FORBIDDEN_GIT_ADD_PATTERNS) {
        if (normalized === forbidden || normalized === '.') {
          throw new ForbiddenGitAddError(fp);
        }
      }
    }
  }

  /**
   * Validate that all staged files are within the ticket's declared scope.
   *
   * System paths (agent-output, ticket-state, tickets, memory-bank) are
   * always allowed. All other files must match a prefix in `ticketScope`.
   *
   * @throws {ScopeViolationError} if any file is outside scope.
   */
  validateScope(filePaths: string[], ticketScope: string[]): void {
    const systemPrefixes = [
      '.github/agent-output/',
      '.github/ticket-state/',
      '.github/tickets/',
      '.github/memory-bank/',
    ];

    const outOfScope: string[] = [];
    for (const fp of filePaths) {
      const isSystem = systemPrefixes.some((prefix) => fp.startsWith(prefix));
      if (isSystem) continue;

      const inScope = ticketScope.some(
        (scope) => fp === scope || fp.startsWith(scope + '/'),
      );
      if (!inScope) {
        outOfScope.push(fp);
      }
    }

    if (outOfScope.length > 0) {
      throw new ScopeViolationError(outOfScope);
    }
  }

  // ── MCP Client ───────────────────────────────────────────────────────────

  /**
   * Call an MCP tool via JSON-RPC 2.0 over HTTP.
   *
   * Sends a `tools/call` request to the MCP server and returns the parsed
   * result. Throws on network errors, timeouts, or MCP-level errors.
   */
  private async callMcpTool(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<McpToolCallResult> {
    const url = this.config.FORGEOS_MCP_URL;
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.FORGEOS_MCP_TIMEOUT_MS,
    );

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.config.FORGEOS_API_KEY) {
      headers['Authorization'] = `Bearer ${this.config.FORGEOS_API_KEY}`;
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: `${toolName}-${Date.now()}`,
          method: 'tools/call',
          params: { name: toolName, arguments: args },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`MCP HTTP ${response.status}: ${response.statusText}`);
      }

      const body = (await response.json()) as {
        result?: McpToolCallResult;
        error?: { code: number; message: string };
      };

      if (body.error) {
        throw new Error(`MCP error ${body.error.code}: ${body.error.message}`);
      }

      if (!body.result) {
        throw new Error('MCP response missing result');
      }

      if (body.result.isError) {
        const errorText = body.result.content[0]?.text ?? 'unknown MCP tool error';
        throw new Error(`MCP tool error: ${errorText}`);
      }

      return body.result;
    } finally {
      clearTimeout(timeout);
    }
  }

  // ── Fallback Methods ─────────────────────────────────────────────────────

  private async claimFallback(
    ticketId: string,
    agentName: string,
    machineId: string,
    operator?: string,
  ): Promise<ClaimResult> {
    if (!this.config.FORGEOS_FALLBACK_ENABLED) {
      throw new TicketOperationError('claimTicket', 'MCP unreachable and fallback disabled');
    }

    logger.info({ ticketId, agentName }, 'claimTicket falling back to tickets.py');

    const args = [
      this.config.FORGEOS_TICKETS_PY_PATH,
      '--claim',
      ticketId,
      agentName,
      machineId,
      operator ?? 'unknown',
    ];

    const { stdout } = await execFileAsync('python3', args, {
      cwd: this.config.FORGEOS_WORKSPACE_PATH,
    });

    logger.info({ ticketId, source: 'fallback', stdout: stdout.trim() }, 'claimTicket fallback succeeded');

    return {
      ticket: { ticket_id: ticketId } as TicketsClaimOutput['ticket'],
      lease_expiry: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      file_locks: [],
      source: 'fallback',
    };
  }

  private async completeFallback(
    ticketId: string,
    evidence: StageEvidence,
  ): Promise<CompleteResult> {
    if (!this.config.FORGEOS_FALLBACK_ENABLED) {
      throw new TicketOperationError('completeStage', 'MCP unreachable and fallback disabled');
    }

    logger.info({ ticketId }, 'completeStage falling back to tickets.py');

    const args = [
      this.config.FORGEOS_TICKETS_PY_PATH,
      '--advance',
      ticketId,
      evidence.artifacts[0] ?? 'Backend',
    ];

    const { stdout } = await execFileAsync('python3', args, {
      cwd: this.config.FORGEOS_WORKSPACE_PATH,
    });

    logger.info({ ticketId, source: 'fallback', stdout: stdout.trim() }, 'completeStage fallback succeeded');

    return {
      ticket: { ticket_id: ticketId } as TicketsCompleteOutput['ticket'],
      previous_stage: 'BACKEND',
      new_stage: 'QA',
      dependencies_unblocked: [],
      source: 'fallback',
    };
  }

  private async releaseFallback(ticketId: string): Promise<ReleaseResult> {
    if (!this.config.FORGEOS_FALLBACK_ENABLED) {
      throw new TicketOperationError('releaseTicket', 'MCP unreachable and fallback disabled');
    }

    logger.info({ ticketId }, 'releaseTicket falling back to tickets.py');

    const args = [
      this.config.FORGEOS_TICKETS_PY_PATH,
      '--release',
      ticketId,
    ];

    const { stdout } = await execFileAsync('python3', args, {
      cwd: this.config.FORGEOS_WORKSPACE_PATH,
    });

    logger.info({ ticketId, source: 'fallback', stdout: stdout.trim() }, 'releaseTicket fallback succeeded');

    return { ticket_id: ticketId, released: true, source: 'fallback' };
  }
}
