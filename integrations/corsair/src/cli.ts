#!/usr/bin/env node
/**
 * forgeos-corsair — ingest GitHub (or Linear) Issues into ForgeOS warm tickets.
 *
 * Usage:
 *   tsx src/cli.ts --owner <org> --repo <name> [--state open|closed|all]
 *       [--source github|linear] [--fake] [--tickets-dir <path>]
 *       [--limit N] [--update] [--comment] [--dry-run] [--sync]
 *
 *   --source       issue source plugin (default: github)
 *   --fake         use built-in sample issues (no Corsair/network needed)
 *   --tickets-dir  override output dir (default: <repo-root>/tickets)
 *   --limit        cap number of issues processed
 *   --update       refresh existing tickets when the issue changed
 *   --comment      post a write-back comment on each ingested issue (Corsair)
 *   --dry-run      map + print only; write nothing
 *   --sync         run `python tickets.py --sync` after writing
 *
 * Config: a local `.env` is loaded when `dotenv` is installed. Secrets
 * (CORSAIR_KEK / tokens) are NEVER printed.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ingest, FakeIssueSource, FakeCommentSink, CorsairIssueSource, CorsairCommentSink,
  LinearIssueSource, type Issue, type IssueSource, type CommentSink,
} from './connector.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

/** Load .env if dotenv is available (optional dependency). Never throws. */
async function loadEnv(): Promise<void> {
  try {
    const dotenv = await import('dotenv' as any);
    dotenv.config();
  } catch {
    /* dotenv not installed — rely on the ambient environment */
  }
}

/** Walk up from this file to the ForgeOS repo root (the dir containing tickets.py). */
function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'tickets.py'))) return dir;
    dir = dirname(dir);
  }
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
}

const SAMPLE_ISSUES: Issue[] = [
  {
    number: 101,
    title: 'API returns 500 when ticket has no acceptance criteria',
    body: 'Steps:\n- [ ] Reproduce the 500 on empty criteria\n- [ ] Add a guard + default in `tickets.py`\n- [ ] Cover with a regression test',
    state: 'open',
    htmlUrl: 'https://github.com/example/repo/issues/101',
    labels: [{ name: 'bug' }, { name: 'backend' }, { name: 'high' }],
    assignee: { login: 'reaperoak' },
    milestone: 'Week 2',
  },
  {
    number: 102,
    title: 'Document the Corsair ingestion connector',
    body: 'Add a how-to for ingesting GitHub issues into ForgeOS.',
    state: 'open',
    htmlUrl: 'https://github.com/example/repo/issues/102',
    labels: [{ name: 'documentation' }],
  },
];

function pickSource(fake: boolean, source: string, limit?: number): IssueSource {
  if (fake) return new FakeIssueSource(SAMPLE_ISSUES);
  if (source === 'linear') return new LinearIssueSource();
  return new CorsairIssueSource({ limit });
}

async function main() {
  await loadEnv();

  const owner = arg('owner') ?? 'example';
  const repo = arg('repo') ?? 'repo';
  const state = arg('state') ?? 'open';
  const source = (arg('source') ?? 'github').toLowerCase();
  const limit = arg('limit') ? Number(arg('limit')) : undefined;
  const fake = flag('fake');
  const dryRun = flag('dry-run');
  const doComment = flag('comment');
  const root = repoRoot();
  const ticketsDir = arg('tickets-dir') ?? join(root, 'tickets');

  const issueSource = pickSource(fake, source, limit);
  // Offline fake gets an in-memory sink so --comment is demoable without Corsair.
  const commenter: CommentSink | undefined = doComment
    ? (fake ? new FakeCommentSink() : new CorsairCommentSink())
    : undefined;

  const tags = [
    fake ? 'FAKE' : `source=${source}`,
    dryRun ? 'DRY-RUN' : null,
    flag('update') ? 'UPDATE' : null,
    doComment ? 'COMMENT' : null,
  ].filter(Boolean).join(' ');
  console.log(`[forgeos-corsair] ingesting ${owner}/${repo} (state=${state}) [${tags}]`);

  const res = await ingest(issueSource, {
    owner, repo, state, ticketsDir, limit,
    update: flag('update'), dryRun, comment: doComment, commenter,
  });

  for (const c of res.created) console.log(`  + ${c.ticketId}`);
  for (const u of res.updated) console.log(`  ~ ${u.ticketId} (updated)`);
  for (const s of res.skipped) console.log(`  = ${s.ticketId} (${s.reason})`);
  for (const c of res.commented) console.log(`  💬 ${c.ticketId} → issue #${c.issueNumber}`);
  console.log(
    `[forgeos-corsair] created ${res.created.length}, updated ${res.updated.length}, ` +
    `skipped ${res.skipped.length}${dryRun ? ' (DRY-RUN — nothing written)' : ''} -> ${ticketsDir}`,
  );

  if (flag('sync') && !dryRun && res.created.length + res.updated.length > 0) {
    console.log('[forgeos-corsair] running tickets.py --sync ...');
    const py = spawnSync('python3', [join(root, 'tickets.py'), '--sync'], { cwd: root, stdio: 'inherit' });
    if (py.status !== 0) console.warn('[forgeos-corsair] sync failed — run `python tickets.py --sync` manually.');
  } else if (!dryRun) {
    console.log('[forgeos-corsair] next: run `python tickets.py --sync` to move tickets to READY.');
  }
}

main().catch((err) => {
  console.error('[forgeos-corsair] error:', err?.message ?? err);
  process.exit(1);
});
