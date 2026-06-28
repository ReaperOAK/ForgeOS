/**
 * ForgeOS × Corsair connector — core logic.
 *
 * Turns GitHub Issues (fetched through Corsair's open integration layer) into
 * ForgeOS "warm" tickets that the Python state machine (tickets.py) consumes.
 *
 * The ForgeOS ticket schema mirrors tickets.py::create_ticket so that
 * `python tickets.py --sync` and the SDLC agents treat ingested tickets
 * identically to natively-created ones.
 *
 * Corsair dependencies are LAZY-IMPORTED everywhere, so the package installs,
 * builds and tests fully offline (zero network / zero native deps) until you
 * choose to go live.
 */

import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------- Types ----------

/** Normalized GitHub issue (subset of Corsair's issue object). */
export interface Issue {
  number: number;
  title: string;
  body?: string | null;
  state?: string;
  htmlUrl?: string;
  labels?: Array<string | { name?: string }>;
  /** GitHub assignee — login string or object. Mapped to ticket.operator. */
  assignee?: string | { login?: string } | null;
  /** GitHub milestone — title string or object. Mapped to a ticket tag. */
  milestone?: string | { title?: string } | null;
}

export type TicketType =
  | 'backend' | 'frontend' | 'fullstack' | 'infra'
  | 'security' | 'docs' | 'research' | 'architecture' | 'pm';

export type Priority = 'critical' | 'high' | 'medium' | 'low';

export interface HistoryEvent {
  timestamp: string;
  event: string;
  agent: string;
  machine_id: string;
  details: string;
}

export interface ForgeOSTicket {
  ticket_id: string;
  title: string;
  description: string;
  type: TicketType;
  priority: Priority;
  stage: string;
  sdlc_flow: string[];
  created_at: string;
  created_by: string;
  dependencies: string[];
  blocked_by: string[];
  file_paths: string[];
  acceptance_criteria: string[];
  rework_count: number;
  claimed_by: string | null;
  machine_id: string | null;
  operator: string | null;
  lease_expiry: string | null;
  lease_duration_minutes: number;
  history: HistoryEvent[];
  source_task_file: string | null;
  tags: string[];
}

// ---------- SDLC flows (kept in sync with tickets.py::SDLC_FLOWS) ----------

export const SDLC_FLOWS: Record<TicketType, string[]> = {
  backend: ['READY', 'BACKEND', 'QA', 'SECURITY', 'CI', 'DOCS', 'VALIDATION', 'DONE'],
  frontend: ['READY', 'UIDESIGNER', 'FRONTEND', 'QA', 'SECURITY', 'CI', 'DOCS', 'VALIDATION', 'DONE'],
  fullstack: ['READY', 'BACKEND', 'UIDESIGNER', 'FRONTEND', 'QA', 'SECURITY', 'CI', 'DOCS', 'VALIDATION', 'DONE'],
  infra: ['READY', 'DEVOPS', 'QA', 'SECURITY', 'CI', 'DOCS', 'VALIDATION', 'DONE'],
  security: ['READY', 'SECURITY', 'QA', 'CI', 'DOCS', 'VALIDATION', 'DONE'],
  docs: ['READY', 'DOCS', 'VALIDATION', 'DONE'],
  research: ['READY', 'RESEARCH', 'DOCS', 'VALIDATION', 'DONE'],
  architecture: ['READY', 'ARCHITECT', 'DOCS', 'VALIDATION', 'DONE'],
  pm: ['READY', 'PM', 'DOCS', 'VALIDATION', 'DONE'],
};

const DEFAULT_LEASE_MINUTES = 30;
const CONNECTOR_AGENT = 'corsair-connector';

// ---------- Pure helpers (the high-value, fully-tested logic) ----------

function labelNames(issue: Issue): string[] {
  return (issue.labels ?? [])
    .map((l) => (typeof l === 'string' ? l : l?.name ?? ''))
    .map((s) => s.toLowerCase().trim())
    .filter(Boolean);
}

/** Infer ForgeOS ticket type from issue labels. Defaults to backend (full SDLC flow). */
export function inferType(issue: Issue): TicketType {
  const labels = labelNames(issue);
  const has = (...keys: string[]) => keys.some((k) => labels.some((l) => l.includes(k)));
  if (has('security', 'vuln', 'cve')) return 'security';
  if (has('docs', 'documentation')) return 'docs';
  if (has('infra', 'devops', 'ci', 'deploy')) return 'infra';
  if (has('research', 'spike', 'investigate')) return 'research';
  if (has('architecture', 'design', 'rfc')) return 'architecture';
  if (has('frontend', 'ui', 'ux', 'css')) return 'frontend';
  if (has('fullstack')) return 'fullstack';
  return 'backend';
}

/** Infer priority from issue labels. Defaults to medium. */
export function inferPriority(issue: Issue): Priority {
  const labels = labelNames(issue);
  const has = (...keys: string[]) => keys.some((k) => labels.some((l) => l.includes(k)));
  if (has('critical', 'p0', 'urgent', 'blocker')) return 'critical';
  if (has('high', 'p1', 'important')) return 'high';
  if (has('low', 'p3', 'minor', 'trivial')) return 'low';
  return 'medium';
}

/** Build a filesystem-safe, stable ticket id from repo + issue number. */
export function ticketIdFor(repo: string, issueNumber: number): string {
  const slug = repo.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return `GH-${slug}-${issueNumber}`;
}

/** Extract acceptance criteria from a markdown task list, else derive a default. */
export function extractAcceptanceCriteria(issue: Issue): string[] {
  const body = issue.body ?? '';
  const items = body
    .split('\n')
    .map((line) => line.match(/^\s*[-*]\s*\[[ xX]\]\s*(.+\S)\s*$/))
    .filter((m): m is RegExpMatchArray => Boolean(m))
    .map((m) => m[1].trim());
  if (items.length > 0) return items;
  return [`Resolve issue: ${issue.title}`];
}

const CODE_EXT =
  'ts|tsx|js|jsx|mjs|cjs|py|json|md|css|scss|html|go|rs|java|kt|rb|php|c|h|cpp|hpp|yml|yaml|toml|sh|sql|vue|svelte';

function isPathLike(token: string): boolean {
  const t = token.trim();
  if (!t || /\s/.test(t) || t.includes('://')) return false;
  // a real path segment (has a slash + extension) or a bare known-source filename
  if (/[\w.-]+\/[\w./-]+\.[A-Za-z0-9]+$/.test(t)) return true;
  return new RegExp(`^[\\w.-]+\\.(${CODE_EXT})$`, 'i').test(t);
}

/**
 * Extract file paths referenced in the issue title/body — both backtick code
 * spans and bare path tokens. URLs are ignored. Returns a sorted, de-duped list.
 */
export function extractFilePaths(issue: Issue): string[] {
  // Strip URLs first so we never mistake a URL path for a repo file path.
  const text = `${issue.title}\n${issue.body ?? ''}`.replace(/\b[a-z]+:\/\/\S+/gi, ' ');
  const found = new Set<string>();

  // backticked spans: `src/foo.ts`, `tickets.py`
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    if (isPathLike(m[1])) found.add(m[1].trim());
  }
  // bare path tokens with at least one directory segment + extension
  for (const m of text.matchAll(/(?<![\w`/.])((?:[\w-]+\/)+[\w.-]+\.[A-Za-z0-9]+)/g)) {
    found.add(m[1]);
  }
  return [...found].sort();
}

/** Map assignee → operator (nullable). */
export function inferOperator(issue: Issue): string | null {
  const a = issue.assignee;
  if (!a) return null;
  const login = typeof a === 'string' ? a : a.login;
  return login?.trim() || null;
}

/** Map milestone → a `milestone:<slug>` tag (or null when absent). */
export function milestoneTag(issue: Issue): string | null {
  const ms = issue.milestone;
  if (!ms) return null;
  const title = typeof ms === 'string' ? ms : ms.title;
  const slug = (title ?? '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
  return slug ? `milestone:${slug}` : null;
}

function ticketTags(issue: Issue): string[] {
  const ms = milestoneTag(issue);
  return Array.from(
    new Set([...labelNames(issue), 'github', 'corsair-ingest', ...(ms ? [ms] : [])]),
  );
}

/** Map a GitHub issue to a ForgeOS ticket (pure). */
export function mapIssueToTicket(
  issue: Issue,
  opts: { owner: string; repo: string; createdAt?: string },
): ForgeOSTicket {
  const now = opts.createdAt ?? new Date().toISOString();
  const type = inferType(issue);
  const id = ticketIdFor(opts.repo, issue.number);
  const description = (issue.body ?? '').trim() || issue.title;
  return {
    ticket_id: id,
    title: issue.title,
    description,
    type,
    priority: inferPriority(issue),
    stage: 'READY',
    sdlc_flow: SDLC_FLOWS[type],
    created_at: now,
    created_by: CONNECTOR_AGENT,
    dependencies: [],
    blocked_by: [],
    file_paths: extractFilePaths(issue),
    acceptance_criteria: extractAcceptanceCriteria(issue),
    rework_count: 0,
    claimed_by: null,
    machine_id: null,
    operator: inferOperator(issue),
    lease_expiry: null,
    lease_duration_minutes: DEFAULT_LEASE_MINUTES,
    history: [
      {
        timestamp: now,
        event: 'CREATED',
        agent: CONNECTOR_AGENT,
        machine_id: 'system',
        details: `Ingested from GitHub issue ${opts.owner}/${opts.repo}#${issue.number} via Corsair`,
      },
    ],
    source_task_file: issue.htmlUrl ?? null,
    tags: ticketTags(issue),
  };
}

const arrEq = (a: unknown[], b: unknown[]): boolean =>
  JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

/**
 * Has the upstream issue changed in a way that should refresh the canonical
 * ticket? Compares the mapped content fields (title/body/type/priority/labels/
 * acceptance/file_paths), ignoring lifecycle state.
 */
export function issueChanged(existing: ForgeOSTicket, issue: Issue): boolean {
  const fresh = mapIssueToTicket(issue, {
    owner: '-', repo: '-', createdAt: existing.created_at,
  });
  return (
    existing.title !== fresh.title ||
    existing.description !== fresh.description ||
    existing.priority !== fresh.priority ||
    existing.type !== fresh.type ||
    !arrEq(existing.tags, fresh.tags) ||
    !arrEq(existing.acceptance_criteria, fresh.acceptance_criteria) ||
    !arrEq(existing.file_paths, fresh.file_paths)
  );
}

/**
 * Merge a changed issue into an existing ticket, refreshing content while
 * PRESERVING lifecycle state: created_at, created_by, rework_count, claim/lease
 * fields, current stage, sdlc_flow, dependencies and history (an `UPDATED`
 * event is appended).
 */
export function mergeTicketUpdate(
  existing: ForgeOSTicket,
  issue: Issue,
  opts: { owner: string; repo: string; updatedAt?: string },
): ForgeOSTicket {
  const now = opts.updatedAt ?? new Date().toISOString();
  const fresh = mapIssueToTicket(issue, {
    owner: opts.owner, repo: opts.repo, createdAt: existing.created_at,
  });
  return {
    ...fresh,
    // preserved lifecycle / identity fields
    ticket_id: existing.ticket_id,
    created_at: existing.created_at,
    created_by: existing.created_by,
    rework_count: existing.rework_count,
    claimed_by: existing.claimed_by,
    machine_id: existing.machine_id,
    operator: existing.operator ?? fresh.operator,
    lease_expiry: existing.lease_expiry,
    lease_duration_minutes: existing.lease_duration_minutes,
    stage: existing.stage,
    sdlc_flow: existing.sdlc_flow,
    dependencies: existing.dependencies,
    blocked_by: existing.blocked_by,
    history: [
      ...existing.history,
      {
        timestamp: now,
        event: 'UPDATED',
        agent: CONNECTOR_AGENT,
        machine_id: 'system',
        details: `Refreshed from GitHub issue ${opts.owner}/${opts.repo}#${issue.number} via Corsair`,
      },
    ],
  };
}

/** Build the write-back comment posted to the source issue (pure). */
export function buildIngestComment(ticket: ForgeOSTicket): string {
  return (
    `🤖 ForgeOS ingested this issue → ticket \`${ticket.ticket_id}\`\n` +
    `- type: \`${ticket.type}\`\n` +
    `- priority: \`${ticket.priority}\`\n` +
    `- stage: \`${ticket.stage}\` (queued into the SDLC)`
  );
}

// ---------- Issue sources + write-back sinks ----------

export interface IssueSource {
  fetchIssues(owner: string, repo: string, state?: string): Promise<Issue[]>;
}

/** Sink for posting write-back comments to the source issue. */
export interface CommentSink {
  comment(owner: string, repo: string, issueNumber: number, body: string): Promise<void>;
}

/** Offline source for tests + `--fake` demos. */
export class FakeIssueSource implements IssueSource {
  constructor(private readonly issues: Issue[]) {}
  async fetchIssues(): Promise<Issue[]> {
    return this.issues;
  }
}

/** Offline, in-memory comment sink for tests + `--fake` demos. */
export class FakeCommentSink implements CommentSink {
  public readonly posted: Array<{ owner: string; repo: string; issueNumber: number; body: string }> = [];
  async comment(owner: string, repo: string, issueNumber: number, body: string): Promise<void> {
    this.posted.push({ owner, repo, issueNumber, body });
  }
}

// ---- Corsair boundary (the one documented `any` region) ----

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Build a live Corsair client with the given plugin. Lazy-imports corsair +
 * the plugin + better-sqlite3 so nothing native/network loads until called.
 * Never logs the KEK or token.
 */
async function corsairClient(plugin: 'github' | 'linear'): Promise<any> {
  const kek = process.env.CORSAIR_KEK;
  if (!kek) {
    throw new Error('CORSAIR_KEK is not set — see the connector setup notes (never log the key).');
  }
  const { createCorsair } = await import('corsair' as any);
  const Database = (await import('better-sqlite3' as any)).default;
  const db = new Database(process.env.CORSAIR_DB ?? 'corsair.db');

  if (plugin === 'linear') {
    let linear: any;
    try {
      ({ linear } = await import('@corsair-dev/linear' as any));
    } catch {
      throw new Error(
        'Linear source not wired: install @corsair-dev/linear to enable. ' +
          'Same IssueSource interface — swap the plugin, no new auth.',
      );
    }
    return createCorsair({ plugins: [linear()], database: db, kek, multiTenancy: false });
  }

  const { github } = await import('@corsair-dev/github' as any);
  return createCorsair({ plugins: [github()], database: db, kek, multiTenancy: false });
}

function normalizeList(raw: any): any[] {
  if (Array.isArray(raw)) return raw;
  return raw?.data ?? raw?.issues ?? raw?.nodes ?? [];
}

function normalizeGithubIssue(i: any): Issue {
  return {
    number: i.number,
    title: i.title,
    body: i.body,
    state: i.state,
    htmlUrl: i.htmlUrl ?? i.html_url,
    labels: i.labels,
    assignee: i.assignee,
    milestone: i.milestone,
  };
}

/**
 * Live Corsair-backed GitHub source. Pages through ALL results, drops PRs
 * (GitHub returns them in the issues feed), and honors an optional limit.
 */
export class CorsairIssueSource implements IssueSource {
  constructor(private readonly opts: { perPage?: number; limit?: number } = {}) {}

  async fetchIssues(owner: string, repo: string, state = 'open'): Promise<Issue[]> {
    const corsair = await corsairClient('github');
    const perPage = this.opts.perPage ?? 100;
    const limit = this.opts.limit ?? Infinity;
    const out: Issue[] = [];

    for (let page = 1; ; page++) {
      const raw = await corsair.github.api.issues.list({ owner, repo, state, perPage, page });
      const list = normalizeList(raw);
      if (list.length === 0) break;
      for (const i of list) {
        if (i.pullRequest || i.pull_request) continue; // drop PRs
        out.push(normalizeGithubIssue(i));
        if (out.length >= limit) return out;
      }
      if (list.length < perPage) break; // last page
    }
    return out;
  }
}

/** Live Corsair-backed GitHub write-back sink. */
export class CorsairCommentSink implements CommentSink {
  async comment(owner: string, repo: string, issueNumber: number, body: string): Promise<void> {
    const corsair = await corsairClient('github');
    await corsair.github.api.issues.createComment({ owner, repo, issueNumber, body });
  }
}

/**
 * Second source (proof of extensibility). Real when @corsair-dev/linear is
 * installed; otherwise a clear, actionable error. Same IssueSource interface —
 * Corsair = swap-a-plugin, not new auth.
 */
export class LinearIssueSource implements IssueSource {
  async fetchIssues(_owner: string, _repo: string, state = 'open'): Promise<Issue[]> {
    const corsair = await corsairClient('linear');
    const raw = await corsair.linear.api.issues.list({ state });
    return normalizeList(raw).map((i: any) => ({
      number: i.number ?? i.identifier ?? 0,
      title: i.title,
      body: i.description ?? i.body,
      state: i.state?.name ?? i.state,
      htmlUrl: i.url ?? i.htmlUrl,
      labels: i.labels?.nodes ?? i.labels,
      assignee: i.assignee?.displayName ?? i.assignee,
      milestone: i.milestone ?? i.projectMilestone,
    }));
  }
}

/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------- Ingest ----------

export interface IngestResult {
  created: Array<{ ticketId: string; path: string }>;
  updated: Array<{ ticketId: string; path: string }>;
  skipped: Array<{ ticketId: string; reason: string }>;
  commented: Array<{ ticketId: string; issueNumber: number }>;
  dryRun: boolean;
}

export interface IngestOptions {
  owner: string;
  repo: string;
  state?: string;
  ticketsDir: string;
  createdAt?: string;
  /** Refresh existing tickets when the issue changed (default: idempotent skip). */
  update?: boolean;
  /** Map + report only; write nothing. */
  dryRun?: boolean;
  /** Post a write-back comment on the source issue for each created ticket. */
  comment?: boolean;
  /** Sink used when `comment` is on. */
  commenter?: CommentSink;
  /** Cap the number of issues processed. */
  limit?: number;
}

/**
 * Fetch issues via the given source, map to tickets, and write canonical
 * ticket JSON to `ticketsDir`. Existing tickets are skipped (idempotent) unless
 * `update` is set. Run `python tickets.py --sync` afterward to materialize
 * READY state.
 */
export async function ingest(source: IssueSource, opts: IngestOptions): Promise<IngestResult> {
  const all = await source.fetchIssues(opts.owner, opts.repo, opts.state ?? 'open');
  const issues = opts.limit != null ? all.slice(0, opts.limit) : all;

  const dryRun = opts.dryRun ?? false;
  if (!dryRun && !existsSync(opts.ticketsDir)) mkdirSync(opts.ticketsDir, { recursive: true });

  const result: IngestResult = { created: [], updated: [], skipped: [], commented: [], dryRun };

  const write = (path: string, ticket: ForgeOSTicket): void => {
    if (!dryRun) writeFileSync(path, JSON.stringify(ticket, null, 2) + '\n', 'utf8');
  };

  for (const issue of issues) {
    const id = ticketIdFor(opts.repo, issue.number);
    const path = join(opts.ticketsDir, `${id}.json`);

    if (existsSync(path)) {
      if (opts.update) {
        let existing: ForgeOSTicket;
        try {
          existing = JSON.parse(readFileSync(path, 'utf8')) as ForgeOSTicket;
        } catch {
          result.skipped.push({ ticketId: id, reason: 'unreadable existing ticket' });
          continue;
        }
        if (issueChanged(existing, issue)) {
          const merged = mergeTicketUpdate(existing, issue, {
            owner: opts.owner, repo: opts.repo, updatedAt: opts.createdAt,
          });
          write(path, merged);
          result.updated.push({ ticketId: id, path });
        } else {
          result.skipped.push({ ticketId: id, reason: 'unchanged' });
        }
      } else {
        result.skipped.push({ ticketId: id, reason: 'already exists' });
      }
      continue;
    }

    const ticket = mapIssueToTicket(issue, opts);
    write(path, ticket);
    result.created.push({ ticketId: id, path });

    if (opts.comment && opts.commenter && !dryRun) {
      await opts.commenter.comment(opts.owner, opts.repo, issue.number, buildIngestComment(ticket));
      result.commented.push({ ticketId: id, issueNumber: issue.number });
    }
  }
  return result;
}
