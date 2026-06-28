import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  mapIssueToTicket, inferType, inferPriority, ticketIdFor,
  extractAcceptanceCriteria, extractFilePaths, inferOperator, milestoneTag,
  issueChanged, mergeTicketUpdate, buildIngestComment,
  ingest, FakeIssueSource, FakeCommentSink, SDLC_FLOWS,
  type Issue,
} from '../connector.js';

const issue = (over: Partial<Issue> = {}): Issue => ({
  number: 7, title: 'Fix the thing', body: 'desc', state: 'open',
  htmlUrl: 'https://github.com/o/r/issues/7', labels: [], ...over,
});

describe('inferType', () => {
  it('maps labels to ForgeOS types', () => {
    expect(inferType(issue({ labels: [{ name: 'security' }] }))).toBe('security');
    expect(inferType(issue({ labels: ['frontend'] }))).toBe('frontend');
    expect(inferType(issue({ labels: [{ name: 'documentation' }] }))).toBe('docs');
    expect(inferType(issue({ labels: [{ name: 'devops' }] }))).toBe('infra');
  });
  it('defaults to backend', () => {
    expect(inferType(issue({ labels: [] }))).toBe('backend');
  });
});

describe('inferPriority', () => {
  it('reads priority labels', () => {
    expect(inferPriority(issue({ labels: ['P0'] }))).toBe('critical');
    expect(inferPriority(issue({ labels: [{ name: 'high' }] }))).toBe('high');
    expect(inferPriority(issue({ labels: ['minor'] }))).toBe('low');
  });
  it('defaults to medium', () => {
    expect(inferPriority(issue({ labels: [] }))).toBe('medium');
  });
});

describe('ticketIdFor', () => {
  it('produces a filesystem-safe stable id', () => {
    expect(ticketIdFor('my-cool.repo', 42)).toBe('GH-MYCOOLREPO-42');
  });
});

describe('extractAcceptanceCriteria', () => {
  it('pulls markdown checklist items', () => {
    const ac = extractAcceptanceCriteria(issue({ body: '- [ ] one\n- [x] two\ntext' }));
    expect(ac).toEqual(['one', 'two']);
  });
  it('falls back to a default when no checklist', () => {
    expect(extractAcceptanceCriteria(issue({ body: 'no list', title: 'T' }))).toEqual(['Resolve issue: T']);
  });
});

describe('extractFilePaths', () => {
  it('extracts backticked source paths', () => {
    const paths = extractFilePaths(issue({ body: 'see `src/connector.ts` and `tickets.py`' }));
    expect(paths).toEqual(['src/connector.ts', 'tickets.py']);
  });
  it('extracts bare directory paths', () => {
    const paths = extractFilePaths(issue({ body: 'crash in integrations/corsair/src/cli.ts here' }));
    expect(paths).toContain('integrations/corsair/src/cli.ts');
  });
  it('ignores URLs and prose', () => {
    const paths = extractFilePaths(issue({
      title: 'plain words only', body: 'visit https://example.com/foo/bar.html for info',
    }));
    expect(paths).toEqual([]);
  });
  it('returns [] when nothing path-like', () => {
    expect(extractFilePaths(issue({ title: 'a', body: 'b c d' }))).toEqual([]);
  });
});

describe('inferOperator', () => {
  it('maps a string assignee', () => {
    expect(inferOperator(issue({ assignee: 'octocat' }))).toBe('octocat');
  });
  it('maps an object assignee', () => {
    expect(inferOperator(issue({ assignee: { login: 'octocat' } }))).toBe('octocat');
  });
  it('is null when unassigned', () => {
    expect(inferOperator(issue({ assignee: null }))).toBeNull();
    expect(inferOperator(issue({}))).toBeNull();
  });
});

describe('milestoneTag', () => {
  it('slugifies a milestone title', () => {
    expect(milestoneTag(issue({ milestone: 'Week 1 Release!' }))).toBe('milestone:week-1-release');
    expect(milestoneTag(issue({ milestone: { title: 'v2.0' } }))).toBe('milestone:v20');
  });
  it('is null without a milestone', () => {
    expect(milestoneTag(issue({}))).toBeNull();
  });
});

describe('mapIssueToTicket', () => {
  it('emits a ForgeOS-schema ticket', () => {
    const t = mapIssueToTicket(issue({ labels: [{ name: 'bug' }, { name: 'high' }] }), {
      owner: 'o', repo: 'r', createdAt: '2026-06-28T00:00:00.000Z',
    });
    expect(t.ticket_id).toBe('GH-R-7');
    expect(t.type).toBe('backend');
    expect(t.priority).toBe('high');
    expect(t.stage).toBe('READY');
    expect(t.sdlc_flow).toEqual(SDLC_FLOWS.backend);
    expect(t.created_by).toBe('corsair-connector');
    expect(t.source_task_file).toBe('https://github.com/o/r/issues/7');
    expect(t.tags).toContain('corsair-ingest');
    expect(t.history[0].event).toBe('CREATED');
    // schema completeness — keys the Python state machine expects
    for (const k of ['ticket_id','title','description','type','priority','stage','sdlc_flow',
      'created_at','created_by','dependencies','blocked_by','file_paths','acceptance_criteria',
      'rework_count','claimed_by','machine_id','operator','lease_expiry','lease_duration_minutes',
      'history','source_task_file','tags']) {
      expect(t).toHaveProperty(k);
    }
  });

  it('populates richer mapping (file_paths, operator, milestone tag)', () => {
    const t = mapIssueToTicket(issue({
      body: 'bug in `src/cli.ts`',
      assignee: { login: 'reaperoak' },
      milestone: 'Week 2',
    }), { owner: 'o', repo: 'r', createdAt: '2026-06-28T00:00:00.000Z' });
    expect(t.file_paths).toEqual(['src/cli.ts']);
    expect(t.operator).toBe('reaperoak');
    expect(t.tags).toContain('milestone:week-2');
  });
});

describe('issueChanged / mergeTicketUpdate', () => {
  const base = mapIssueToTicket(issue({ title: 'Old', labels: ['low'] }), {
    owner: 'o', repo: 'r', createdAt: '2026-01-01T00:00:00.000Z',
  });

  it('detects content changes', () => {
    expect(issueChanged(base, issue({ title: 'Old', labels: ['low'] }))).toBe(false);
    expect(issueChanged(base, issue({ title: 'New title', labels: ['low'] }))).toBe(true);
    expect(issueChanged(base, issue({ title: 'Old', labels: ['high'] }))).toBe(true);
  });

  it('preserves created_at, claim/lease and appends UPDATED history', () => {
    const claimed = { ...base, claimed_by: 'agentX', machine_id: 'host1', operator: 'owais',
      lease_expiry: '2026-02-01T00:00:00.000Z', stage: 'BACKEND', rework_count: 2 };
    const merged = mergeTicketUpdate(claimed, issue({ title: 'New', labels: ['high'] }), {
      owner: 'o', repo: 'r', updatedAt: '2026-03-01T00:00:00.000Z',
    });
    expect(merged.created_at).toBe('2026-01-01T00:00:00.000Z'); // preserved
    expect(merged.title).toBe('New');                            // refreshed
    expect(merged.priority).toBe('high');                        // refreshed
    expect(merged.claimed_by).toBe('agentX');                    // preserved
    expect(merged.machine_id).toBe('host1');                     // preserved
    expect(merged.lease_expiry).toBe('2026-02-01T00:00:00.000Z'); // preserved
    expect(merged.stage).toBe('BACKEND');                        // preserved
    expect(merged.rework_count).toBe(2);                         // preserved
    expect(merged.history.at(-1)?.event).toBe('UPDATED');
    expect(merged.history[0].event).toBe('CREATED');             // original kept
  });
});

describe('buildIngestComment', () => {
  it('renders a judge-friendly write-back body', () => {
    const t = mapIssueToTicket(issue({ labels: ['backend', 'high'] }), { owner: 'o', repo: 'r' });
    const body = buildIngestComment(t);
    expect(body).toContain('ForgeOS ingested');
    expect(body).toContain('`GH-R-7`');
    expect(body).toContain('type: `backend`');
    expect(body).toContain('priority: `high`');
  });
});

describe('ingest', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'forgeos-corsair-')); });
  const clean = () => rmSync(dir, { recursive: true, force: true });

  it('writes one ticket file per issue', async () => {
    const src = new FakeIssueSource([issue({ number: 1 }), issue({ number: 2 })]);
    const res = await ingest(src, { owner: 'o', repo: 'r', ticketsDir: dir });
    expect(res.created).toHaveLength(2);
    const p = join(dir, 'GH-R-1.json');
    expect(existsSync(p)).toBe(true);
    const parsed = JSON.parse(readFileSync(p, 'utf8'));
    expect(parsed.ticket_id).toBe('GH-R-1');
    clean();
  });

  it('is idempotent — skips existing tickets', async () => {
    writeFileSync(join(dir, 'GH-R-1.json'), '{}');
    const src = new FakeIssueSource([issue({ number: 1 })]);
    const res = await ingest(src, { owner: 'o', repo: 'r', ticketsDir: dir });
    expect(res.created).toHaveLength(0);
    expect(res.skipped[0].ticketId).toBe('GH-R-1');
    clean();
  });

  it('honors --limit', async () => {
    const src = new FakeIssueSource([issue({ number: 1 }), issue({ number: 2 }), issue({ number: 3 })]);
    const res = await ingest(src, { owner: 'o', repo: 'r', ticketsDir: dir, limit: 2 });
    expect(res.created).toHaveLength(2);
    clean();
  });

  it('dry-run writes nothing', async () => {
    const src = new FakeIssueSource([issue({ number: 1 })]);
    const res = await ingest(src, { owner: 'o', repo: 'r', ticketsDir: dir, dryRun: true });
    expect(res.dryRun).toBe(true);
    expect(res.created).toHaveLength(1);
    expect(existsSync(join(dir, 'GH-R-1.json'))).toBe(false); // nothing written
    clean();
  });

  it('posts a write-back comment per created ticket when --comment', async () => {
    const sink = new FakeCommentSink();
    const src = new FakeIssueSource([issue({ number: 5, labels: ['high'] })]);
    const res = await ingest(src, {
      owner: 'o', repo: 'r', ticketsDir: dir, comment: true, commenter: sink,
    });
    expect(res.commented).toEqual([{ ticketId: 'GH-R-5', issueNumber: 5 }]);
    expect(sink.posted).toHaveLength(1);
    expect(sink.posted[0]).toMatchObject({ owner: 'o', repo: 'r', issueNumber: 5 });
    expect(sink.posted[0].body).toContain('GH-R-5');
    clean();
  });

  it('does not comment in dry-run', async () => {
    const sink = new FakeCommentSink();
    const src = new FakeIssueSource([issue({ number: 5 })]);
    await ingest(src, { owner: 'o', repo: 'r', ticketsDir: dir, comment: true, commenter: sink, dryRun: true });
    expect(sink.posted).toHaveLength(0);
    clean();
  });

  it('update mode refreshes changed tickets and preserves created_at', async () => {
    // seed an existing ticket
    const original = mapIssueToTicket(issue({ number: 9, title: 'Old', labels: ['low'] }), {
      owner: 'o', repo: 'r', createdAt: '2026-01-01T00:00:00.000Z',
    });
    writeFileSync(join(dir, 'GH-R-9.json'), JSON.stringify(original, null, 2));

    const src = new FakeIssueSource([issue({ number: 9, title: 'New title', labels: ['high'] })]);
    const res = await ingest(src, { owner: 'o', repo: 'r', ticketsDir: dir, update: true,
      createdAt: '2026-03-01T00:00:00.000Z' });
    expect(res.updated).toEqual([{ ticketId: 'GH-R-9', path: join(dir, 'GH-R-9.json') }]);
    const parsed = JSON.parse(readFileSync(join(dir, 'GH-R-9.json'), 'utf8'));
    expect(parsed.title).toBe('New title');
    expect(parsed.created_at).toBe('2026-01-01T00:00:00.000Z');
    expect(parsed.history.at(-1).event).toBe('UPDATED');
    clean();
  });

  it('update mode skips unchanged tickets', async () => {
    const original = mapIssueToTicket(issue({ number: 9, title: 'Same', labels: ['low'] }), {
      owner: 'o', repo: 'r', createdAt: '2026-01-01T00:00:00.000Z',
    });
    writeFileSync(join(dir, 'GH-R-9.json'), JSON.stringify(original, null, 2));
    const src = new FakeIssueSource([issue({ number: 9, title: 'Same', labels: ['low'] })]);
    const res = await ingest(src, { owner: 'o', repo: 'r', ticketsDir: dir, update: true });
    expect(res.updated).toHaveLength(0);
    expect(res.skipped[0]).toMatchObject({ ticketId: 'GH-R-9', reason: 'unchanged' });
    clean();
  });
});
