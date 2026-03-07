/**
 * GitHub Push Event Parser — extracts ticket operations from commit messages.
 *
 * Parses GitHub push webhook payloads into structured data:
 * - Extracts commit SHAs, modified file paths, branch information
 * - Identifies CLAIM commits matching the dispatcher-claim protocol format
 * - Identifies WORK commits matching the agent work completion format
 *
 * All functions in this module are pure — no side effects, no I/O.
 *
 * @module webhooks/parser
 * @ticket TASK-FOS-06-004
 */

// ── GitHub Webhook Payload Types ─────────────────────────────────────────────

/** Author/committer from a GitHub push event. */
export interface GitHubCommitAuthor {
  readonly name: string;
  readonly email: string;
  readonly username?: string;
}

/** Individual commit from a GitHub push event payload. */
export interface GitHubPushCommit {
  readonly id: string;
  readonly message: string;
  readonly timestamp: string;
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly modified: readonly string[];
  readonly author: GitHubCommitAuthor;
}

/** Repository info from a GitHub push event. */
export interface GitHubRepository {
  readonly full_name: string;
  readonly name: string;
  readonly html_url: string;
}

/** Pusher info from a GitHub push event. */
export interface GitHubPusher {
  readonly name: string;
  readonly email?: string;
}

/**
 * GitHub push event webhook payload.
 *
 * @see https://docs.github.com/en/webhooks/webhook-events-and-payloads#push
 */
export interface GitHubPushEvent {
  readonly ref: string;
  readonly before: string;
  readonly after: string;
  readonly repository: GitHubRepository;
  readonly pusher: GitHubPusher;
  readonly commits: readonly GitHubPushCommit[];
  readonly head_commit: GitHubPushCommit | null;
  readonly compare: string;
}

// ── Parsed Output Types ──────────────────────────────────────────────────────

/** Parsed CLAIM operation extracted from a commit message. */
export interface ClaimCommitOp {
  readonly type: 'CLAIM';
  readonly ticketId: string;
  readonly agent: string;
  readonly machine: string;
  readonly operator: string;
  readonly commitSha: string;
}

/** Parsed WORK completion operation extracted from a commit message. */
export interface WorkCommitOp {
  readonly type: 'WORK';
  readonly ticketId: string;
  readonly stage: string;
  readonly agent: string;
  readonly machine: string;
  readonly commitSha: string;
}

/** Union of recognized ticket operations from commit messages. */
export type TicketCommitOp = ClaimCommitOp | WorkCommitOp;

/** Structured representation of a single parsed commit. */
export interface ParsedCommit {
  readonly sha: string;
  readonly message: string;
  readonly timestamp: string;
  readonly addedFiles: readonly string[];
  readonly removedFiles: readonly string[];
  readonly modifiedFiles: readonly string[];
}

/** Fully parsed GitHub push event with extracted ticket operations. */
export interface ParsedPushEvent {
  readonly branch: string;
  readonly beforeSha: string;
  readonly afterSha: string;
  readonly repository: string;
  readonly commits: readonly ParsedCommit[];
  readonly operations: readonly TicketCommitOp[];
}

// ── Commit Message Patterns ──────────────────────────────────────────────────

/**
 * Regex for CLAIM commit messages.
 *
 * Format: `[TICKET-ID] CLAIM by AGENT on MACHINE (OPERATOR)`
 *
 * Capture groups: [1]=ticketId, [2]=agent, [3]=machine, [4]=operator
 */
export const CLAIM_PATTERN =
  /^\[([A-Z0-9_-]+)\]\s+CLAIM\s+by\s+(\S+)\s+on\s+(\S+)\s+\(([^)]+)\)/;

/**
 * Regex for WORK completion commit messages.
 *
 * Format: `[TICKET-ID] STAGE complete by AGENT on MACHINE`
 *
 * Capture groups: [1]=ticketId, [2]=stage, [3]=agent, [4]=machine
 */
export const WORK_PATTERN =
  /^\[([A-Z0-9_-]+)\]\s+(\S+)\s+complete\s+by\s+(\S+)\s+on\s+(\S+)/;

// ── Pure Functions ───────────────────────────────────────────────────────────

/**
 * Extract branch name from a full Git ref string.
 *
 * @param ref - Full Git ref (e.g., `"refs/heads/main"`)
 * @returns Bare branch name (e.g., `"main"`)
 */
export function extractBranch(ref: string): string {
  return ref.replace(/^refs\/heads\//, '');
}

/**
 * Parse a commit message for ticket operations (CLAIM or WORK).
 *
 * @param message - Git commit message text
 * @param commitSha - SHA hash of the commit
 * @returns Parsed operation, or `null` if message matches no known pattern
 */
export function parseCommitMessage(
  message: string,
  commitSha: string,
): TicketCommitOp | null {
  const claimMatch = message.match(CLAIM_PATTERN);
  if (claimMatch !== null) {
    const ticketId = claimMatch[1];
    const agent = claimMatch[2];
    const machine = claimMatch[3];
    const operator = claimMatch[4];
    if (ticketId && agent && machine && operator) {
      return { type: 'CLAIM', ticketId, agent, machine, operator, commitSha };
    }
  }

  const workMatch = message.match(WORK_PATTERN);
  if (workMatch !== null) {
    const ticketId = workMatch[1];
    const stage = workMatch[2];
    const agent = workMatch[3];
    const machine = workMatch[4];
    if (ticketId && stage && agent && machine) {
      return { type: 'WORK', ticketId, stage, agent, machine, commitSha };
    }
  }

  return null;
}

/**
 * Parse a full GitHub push event payload into structured data.
 *
 * Extracts branch info, commit details, file changes, and ticket
 * operations from commit messages. All recognized CLAIM and WORK
 * patterns are collected into the `operations` array.
 *
 * @param payload - Raw GitHub push event webhook payload
 * @returns Fully parsed push event with all extracted data
 */
export function parsePushEvent(payload: GitHubPushEvent): ParsedPushEvent {
  const commits: ParsedCommit[] = payload.commits.map((commit) => ({
    sha: commit.id,
    message: commit.message,
    timestamp: commit.timestamp,
    addedFiles: [...commit.added],
    removedFiles: [...commit.removed],
    modifiedFiles: [...commit.modified],
  }));

  const operations: TicketCommitOp[] = [];
  for (const commit of payload.commits) {
    const op = parseCommitMessage(commit.message, commit.id);
    if (op !== null) {
      operations.push(op);
    }
  }

  return {
    branch: extractBranch(payload.ref),
    beforeSha: payload.before,
    afterSha: payload.after,
    repository: payload.repository.full_name,
    commits,
    operations,
  };
}
