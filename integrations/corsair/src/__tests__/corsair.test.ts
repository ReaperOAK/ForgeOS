/**
 * Mocked-Corsair integration, schema-parity, Python state-machine acceptance,
 * and CLI smoke tests. All run OFFLINE. `vi.mock` replaces the lazy Corsair
 * imports so no network/native db is touched.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, mkdirSync, existsSync, cpSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// ---- hoisted mock fns (referenced inside the hoisted vi.mock factories) ----
const { listMock, createCommentMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  createCommentMock: vi.fn(),
}));

vi.mock('corsair', () => ({
  createCorsair: () => ({
    github: { api: { issues: { list: listMock, createComment: createCommentMock } } },
  }),
}));
vi.mock('@corsair-dev/github', () => ({ github: () => ({}) }));
vi.mock('better-sqlite3', () => ({ default: class FakeDb {} }));

import {
  CorsairIssueSource, CorsairCommentSink, LinearIssueSource, mapIssueToTicket, type Issue,
} from '../connector.js';

const here = dirname(fileURLToPath(import.meta.url));
const corsairRoot = resolve(here, '..', '..');         // integrations/corsair
const repoRoot = resolve(here, '..', '..', '..', '..'); // ForgeOS
const cliPath = join(corsairRoot, 'src', 'cli.ts');

const issue = (over: Partial<Issue> = {}): Issue => ({
  number: 7, title: 'Fix the thing', body: 'desc', state: 'open',
  htmlUrl: 'https://github.com/o/r/issues/7', labels: [], ...over,
});

const STAGES = ['READY', 'RESEARCH', 'PM', 'ARCHITECT', 'DEVOPS', 'BACKEND', 'UIDESIGNER',
  'FRONTEND', 'QA', 'SECURITY', 'CI', 'DOCS', 'VALIDATION', 'DONE'];

const hasPython = spawnSync('python3', ['--version']).status === 0;

describe('CorsairIssueSource (mocked Corsair)', () => {
  beforeEach(() => {
    process.env.CORSAIR_KEK = 'test-kek';
    listMock.mockReset();
    createCommentMock.mockReset();
  });
  afterEach(() => { delete process.env.CORSAIR_KEK; });

  it('pages through results, filters PRs, and calls list() with exact args', async () => {
    listMock
      .mockResolvedValueOnce([
        { number: 1, title: 'a', html_url: 'u1' },
        { number: 2, title: 'pr', pull_request: { url: 'x' } }, // PR -> dropped
      ])
      .mockResolvedValueOnce([{ number: 3, title: 'c' }]); // short page -> stop
    const src = new CorsairIssueSource({ perPage: 2 });
    const issues = await src.fetchIssues('o', 'r', 'open');

    expect(issues.map((i) => i.number)).toEqual([1, 3]);
    expect(listMock).toHaveBeenCalledTimes(2);
    expect(listMock).toHaveBeenNthCalledWith(1, { owner: 'o', repo: 'r', state: 'open', perPage: 2, page: 1 });
    expect(listMock).toHaveBeenNthCalledWith(2, { owner: 'o', repo: 'r', state: 'open', perPage: 2, page: 2 });
  });

  it('honors limit and stops paging early', async () => {
    listMock.mockResolvedValueOnce([{ number: 1 }, { number: 2 }, { number: 3 }]);
    const src = new CorsairIssueSource({ perPage: 100, limit: 2 });
    const issues = await src.fetchIssues('o', 'r');
    expect(issues.map((i) => i.number)).toEqual([1, 2]);
    expect(listMock).toHaveBeenCalledTimes(1);
  });

  it('throws a clear error when CORSAIR_KEK is missing', async () => {
    delete process.env.CORSAIR_KEK;
    await expect(new CorsairIssueSource().fetchIssues('o', 'r')).rejects.toThrow(/CORSAIR_KEK/);
  });
});

describe('CorsairCommentSink (mocked write-back)', () => {
  beforeEach(() => { process.env.CORSAIR_KEK = 'test-kek'; createCommentMock.mockReset(); });
  afterEach(() => { delete process.env.CORSAIR_KEK; });

  it('calls issues.createComment with the exact arg shape', async () => {
    await new CorsairCommentSink().comment('o', 'r', 5, 'hello');
    expect(createCommentMock).toHaveBeenCalledWith({ owner: 'o', repo: 'r', issueNumber: 5, body: 'hello' });
  });
});

describe('LinearIssueSource (extensibility stub)', () => {
  it('gives a clear error when the Linear plugin is not installed', async () => {
    process.env.CORSAIR_KEK = 'test-kek';
    await expect(new LinearIssueSource().fetchIssues('o', 'r')).rejects.toThrow(/Linear source not wired/);
    delete process.env.CORSAIR_KEK;
  });
});

describe('schema parity vs real tickets/*.json (critical — fail loudly on drift)', () => {
  it('generated ticket key set equals a real ForgeOS ticket', () => {
    const ticketsDir = join(repoRoot, 'tickets');
    const sample = readdirSync(ticketsDir).find((f) => f.endsWith('.json') && f !== 'ticket-schema.json');
    expect(sample, 'no real ticket found to compare against').toBeTruthy();
    const real = JSON.parse(readFileSync(join(ticketsDir, sample!), 'utf8'));
    const generated = mapIssueToTicket(issue(), { owner: 'o', repo: 'r' });
    expect(Object.keys(generated).sort()).toEqual(Object.keys(real).sort());
  });
});

describe.skipIf(!hasPython)('Python state-machine acceptance (end-to-end)', () => {
  it('tickets.py accepts connector output: --sync then --validate exit 0', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'forgeos-e2e-'));
    try {
      cpSync(join(repoRoot, 'tickets.py'), join(tmp, 'tickets.py'));
      mkdirSync(join(tmp, 'tickets'), { recursive: true });
      for (const s of STAGES) mkdirSync(join(tmp, 'ticket-state', s), { recursive: true });

      const ticket = mapIssueToTicket(
        issue({ number: 101, title: 'E2E ingested ticket', labels: ['backend', 'high'] }),
        { owner: 'o', repo: 'r' },
      );
      writeFileSync(join(tmp, 'tickets', `${ticket.ticket_id}.json`), JSON.stringify(ticket, null, 2) + '\n');

      const sync = spawnSync('python3', [join(tmp, 'tickets.py'), '--sync'], { cwd: tmp, encoding: 'utf8' });
      expect(sync.status, sync.stderr).toBe(0);

      const validate = spawnSync('python3', [join(tmp, 'tickets.py'), '--validate'], { cwd: tmp, encoding: 'utf8' });
      expect(validate.status, validate.stdout + validate.stderr).toBe(0);

      // the ticket materialized into READY
      expect(existsSync(join(tmp, 'ticket-state', 'READY', `${ticket.ticket_id}.json`))).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 30000);
});

describe('CLI smoke (--fake)', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'forgeos-cli-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('--fake --dry-run prints plan and writes nothing', () => {
    const out = spawnSync('npx', ['tsx', cliPath, '--fake', '--dry-run',
      '--owner', 'o', '--repo', 'r', '--tickets-dir', dir], { cwd: corsairRoot, encoding: 'utf8' });
    expect(out.status, out.stderr).toBe(0);
    expect(out.stdout).toMatch(/DRY-?RUN/i);
    expect(readdirSync(dir)).toHaveLength(0);
  }, 30000);

  it('--fake writes ticket files', () => {
    const out = spawnSync('npx', ['tsx', cliPath, '--fake',
      '--owner', 'o', '--repo', 'r', '--tickets-dir', dir], { cwd: corsairRoot, encoding: 'utf8' });
    expect(out.status, out.stderr).toBe(0);
    expect(existsSync(join(dir, 'GH-R-101.json'))).toBe(true);
  }, 30000);
});

// Live smoke — only runs when a real key is present.
describe.skipIf(!process.env.CORSAIR_KEK)('live Corsair smoke', () => {
  it('fetches issues from a real public repo', async () => {
    const src = new CorsairIssueSource({ limit: 1 });
    const issues = await src.fetchIssues('octocat', 'Hello-World', 'all');
    expect(Array.isArray(issues)).toBe(true);
  }, 60000);
});
