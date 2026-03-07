/**
 * Parser Unit Tests — TASK-FOS-06-004
 *
 * Tests the GitHub push event parser: branch extraction, commit message
 * pattern matching for CLAIM and WORK operations, and full payload parsing.
 *
 * All functions under test are pure — no mocks required.
 *
 * @module webhooks/parser.test
 * @ticket TASK-FOS-06-004
 */

import { describe, it, expect } from 'vitest';
import {
  extractBranch,
  parseCommitMessage,
  parsePushEvent,
  CLAIM_PATTERN,
  WORK_PATTERN,
  type GitHubPushEvent,
  type GitHubPushCommit,
} from './parser.js';

// ── Test Fixtures ────────────────────────────────────────────────────────────

function makeCommit(overrides: Partial<GitHubPushCommit> = {}): GitHubPushCommit {
  return {
    id: 'abc123def456',
    message: 'fix: update readme',
    timestamp: '2026-03-07T10:00:00Z',
    added: [],
    removed: [],
    modified: ['README.md'],
    author: { name: 'Test User', email: 'test@example.com' },
    ...overrides,
  };
}

function makePushEvent(
  overrides: Partial<GitHubPushEvent> = {},
  commits: GitHubPushCommit[] = [],
): GitHubPushEvent {
  return {
    ref: 'refs/heads/main',
    before: '0000000000000000000000000000000000000000',
    after: 'abc123def456789012345678901234567890abcd',
    repository: {
      full_name: 'reaperoak/ForgeOS',
      name: 'ForgeOS',
      html_url: 'https://github.com/reaperoak/ForgeOS',
    },
    pusher: { name: 'reaperoak', email: 'oak@example.com' },
    commits,
    head_commit: commits.length > 0 ? (commits[commits.length - 1] ?? null) : null,
    compare: 'https://github.com/reaperoak/ForgeOS/compare/0000...abc1',
    ...overrides,
  };
}

// ── extractBranch ────────────────────────────────────────────────────────────

describe('extractBranch', () => {
  it('strips refs/heads/ prefix from main', () => {
    expect(extractBranch('refs/heads/main')).toBe('main');
  });

  it('strips refs/heads/ prefix from feature branches', () => {
    expect(extractBranch('refs/heads/feature/webhook-handler')).toBe(
      'feature/webhook-handler',
    );
  });

  it('strips refs/heads/ prefix from nested paths', () => {
    expect(extractBranch('refs/heads/fix/issue/123')).toBe('fix/issue/123');
  });

  it('returns unchanged string if no refs/heads/ prefix', () => {
    expect(extractBranch('main')).toBe('main');
  });

  it('handles refs/tags/ without stripping', () => {
    expect(extractBranch('refs/tags/v1.0.0')).toBe('refs/tags/v1.0.0');
  });
});

// ── CLAIM_PATTERN regex ──────────────────────────────────────────────────────

describe('CLAIM_PATTERN', () => {
  it('matches standard CLAIM commit messages', () => {
    const msg = '[TASK-FOS-01-001] CLAIM by Backend on ws-1 (oak)';
    expect(CLAIM_PATTERN.test(msg)).toBe(true);
  });

  it('captures ticket_id, agent, machine, operator', () => {
    const msg = '[TASK-FOS-02-003] CLAIM by QA on machine-2 (alice)';
    const match = msg.match(CLAIM_PATTERN);
    expect(match).not.toBeNull();
    expect(match?.[1]).toBe('TASK-FOS-02-003');
    expect(match?.[2]).toBe('QA');
    expect(match?.[3]).toBe('machine-2');
    expect(match?.[4]).toBe('alice');
  });

  it('does not match WORK messages', () => {
    const msg = '[TASK-FOS-01-001] BACKEND complete by Backend on ws-1';
    expect(CLAIM_PATTERN.test(msg)).toBe(false);
  });

  it('does not match regular commit messages', () => {
    expect(CLAIM_PATTERN.test('fix: typo in readme')).toBe(false);
  });
});

// ── WORK_PATTERN regex ───────────────────────────────────────────────────────

describe('WORK_PATTERN', () => {
  it('matches standard WORK commit messages', () => {
    const msg = '[TASK-FOS-01-001] BACKEND complete by Backend on ws-1';
    expect(WORK_PATTERN.test(msg)).toBe(true);
  });

  it('captures ticket_id, stage, agent, machine', () => {
    const msg = '[TASK-FOS-06-004] QA complete by QAEngineer on build-server';
    const match = msg.match(WORK_PATTERN);
    expect(match).not.toBeNull();
    expect(match?.[1]).toBe('TASK-FOS-06-004');
    expect(match?.[2]).toBe('QA');
    expect(match?.[3]).toBe('QAEngineer');
    expect(match?.[4]).toBe('build-server');
  });

  it('does not match CLAIM messages', () => {
    const msg = '[TASK-FOS-01-001] CLAIM by Backend on ws-1 (oak)';
    expect(WORK_PATTERN.test(msg)).toBe(false);
  });

  it('does not match regular commit messages', () => {
    expect(WORK_PATTERN.test('chore: bump dependencies')).toBe(false);
  });
});

// ── parseCommitMessage ───────────────────────────────────────────────────────

describe('parseCommitMessage', () => {
  it('parses CLAIM commit messages into ClaimCommitOp', () => {
    const result = parseCommitMessage(
      '[TASK-FOS-01-001] CLAIM by Backend on ws-1 (oak)',
      'sha-1234',
    );
    expect(result).toEqual({
      type: 'CLAIM',
      ticketId: 'TASK-FOS-01-001',
      agent: 'Backend',
      machine: 'ws-1',
      operator: 'oak',
      commitSha: 'sha-1234',
    });
  });

  it('parses WORK commit messages into WorkCommitOp', () => {
    const result = parseCommitMessage(
      '[TASK-FOS-02-003] BACKEND complete by Backend on ws-1',
      'sha-5678',
    );
    expect(result).toEqual({
      type: 'WORK',
      ticketId: 'TASK-FOS-02-003',
      stage: 'BACKEND',
      agent: 'Backend',
      machine: 'ws-1',
      commitSha: 'sha-5678',
    });
  });

  it('returns null for unrelated commit messages', () => {
    expect(parseCommitMessage('fix: update readme', 'sha-0')).toBeNull();
  });

  it('returns null for empty messages', () => {
    expect(parseCommitMessage('', 'sha-0')).toBeNull();
  });

  it('returns null for partial CLAIM matches', () => {
    expect(parseCommitMessage('[TASK-001] CLAIM by', 'sha-0')).toBeNull();
  });

  it('returns null for partial WORK matches', () => {
    expect(parseCommitMessage('[TASK-001] BACKEND complete by', 'sha-0')).toBeNull();
  });

  it('handles ticket IDs with hyphens and underscores', () => {
    const result = parseCommitMessage(
      '[FORGEOS-ARCH_004] CLAIM by Architect on dev-machine (bob)',
      'sha-abc',
    );
    expect(result).not.toBeNull();
    expect(result?.type).toBe('CLAIM');
    if (result?.type === 'CLAIM') {
      expect(result.ticketId).toBe('FORGEOS-ARCH_004');
    }
  });

  it('handles multiline commit messages (only first line matters)', () => {
    const msg = '[TASK-FOS-01-001] CLAIM by Backend on ws-1 (oak)\n\nSome details here';
    const result = parseCommitMessage(msg, 'sha-multi');
    expect(result).not.toBeNull();
    expect(result?.type).toBe('CLAIM');
  });
});

// ── parsePushEvent ───────────────────────────────────────────────────────────

describe('parsePushEvent', () => {
  it('extracts branch name from ref', () => {
    const event = makePushEvent({ ref: 'refs/heads/feature/webhooks' });
    const result = parsePushEvent(event);
    expect(result.branch).toBe('feature/webhooks');
  });

  it('extracts before and after SHAs', () => {
    const event = makePushEvent({
      before: 'aaa111',
      after: 'bbb222',
    });
    const result = parsePushEvent(event);
    expect(result.beforeSha).toBe('aaa111');
    expect(result.afterSha).toBe('bbb222');
  });

  it('extracts repository full name', () => {
    const event = makePushEvent({
      repository: {
        full_name: 'org/repo',
        name: 'repo',
        html_url: 'https://github.com/org/repo',
      },
    });
    const result = parsePushEvent(event);
    expect(result.repository).toBe('org/repo');
  });

  it('parses commit details including file changes', () => {
    const commit = makeCommit({
      id: 'commit-sha-1',
      message: 'feat: add parser',
      timestamp: '2026-03-07T12:00:00Z',
      added: ['src/parser.ts'],
      removed: ['old/file.ts'],
      modified: ['README.md', 'package.json'],
    });
    const event = makePushEvent({}, [commit]);
    const result = parsePushEvent(event);

    expect(result.commits).toHaveLength(1);
    expect(result.commits[0]?.sha).toBe('commit-sha-1');
    expect(result.commits[0]?.message).toBe('feat: add parser');
    expect(result.commits[0]?.addedFiles).toEqual(['src/parser.ts']);
    expect(result.commits[0]?.removedFiles).toEqual(['old/file.ts']);
    expect(result.commits[0]?.modifiedFiles).toEqual(['README.md', 'package.json']);
  });

  it('extracts CLAIM operations from commit messages', () => {
    const commit = makeCommit({
      id: 'claim-sha',
      message: '[TASK-FOS-01-001] CLAIM by Backend on ws-1 (oak)',
    });
    const event = makePushEvent({}, [commit]);
    const result = parsePushEvent(event);

    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]?.type).toBe('CLAIM');
  });

  it('extracts WORK operations from commit messages', () => {
    const commit = makeCommit({
      id: 'work-sha',
      message: '[TASK-FOS-01-001] BACKEND complete by Backend on ws-1',
    });
    const event = makePushEvent({}, [commit]);
    const result = parsePushEvent(event);

    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]?.type).toBe('WORK');
  });

  it('extracts multiple operations from multiple commits', () => {
    const commits = [
      makeCommit({
        id: 'claim-sha-1',
        message: '[TASK-FOS-01-001] CLAIM by Backend on ws-1 (oak)',
      }),
      makeCommit({
        id: 'work-sha-1',
        message: '[TASK-FOS-01-001] BACKEND complete by Backend on ws-1',
      }),
      makeCommit({
        id: 'regular-sha',
        message: 'chore: update deps',
      }),
      makeCommit({
        id: 'claim-sha-2',
        message: '[TASK-FOS-02-003] CLAIM by QA on ws-2 (alice)',
      }),
    ];
    const event = makePushEvent({}, commits);
    const result = parsePushEvent(event);

    expect(result.commits).toHaveLength(4);
    expect(result.operations).toHaveLength(3);
    expect(result.operations.filter((op) => op.type === 'CLAIM')).toHaveLength(2);
    expect(result.operations.filter((op) => op.type === 'WORK')).toHaveLength(1);
  });

  it('handles empty commits array', () => {
    const event = makePushEvent({}, []);
    const result = parsePushEvent(event);
    expect(result.commits).toHaveLength(0);
    expect(result.operations).toHaveLength(0);
  });

  it('ignores non-matching commit messages', () => {
    const commits = [
      makeCommit({ id: 'sha-1', message: 'fix: typo' }),
      makeCommit({ id: 'sha-2', message: 'docs: update readme' }),
    ];
    const event = makePushEvent({}, commits);
    const result = parsePushEvent(event);

    expect(result.commits).toHaveLength(2);
    expect(result.operations).toHaveLength(0);
  });
});
