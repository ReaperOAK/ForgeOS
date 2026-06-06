import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {assessProposal, findDuplicateProposal, proposalSimilarity} from './quality.js';
import type {GitHubComment} from './types.js';

function comment(body: string, login = 'competitor'): GitHubComment {
  return {
    id: 1,
    body,
    user: {login, id: 1},
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    html_url: 'https://github.com/Expensify/App/issues/1#issuecomment-1',
  };
}

test('proposalSimilarity identifies the same technical thesis despite wording changes', () => {
  const first = `
### What is the root cause of that problem?
The split flow never calls \`addPendingNewTransactionIDs\`, so report metadata lacks the child IDs.
### What changes do you think we should make in order to solve the problem?
Call \`addPendingNewTransactionIDs\` for each split child before dismissing the modal.
`;
  const second = `
### What is the root cause of that problem?
New split child IDs are not registered in pendingNewTransactionIDs before navigation.
### What changes do you think we should make in order to solve the problem?
Register every child transaction through addPendingNewTransactionIDs, then navigate.
`;

  assert.ok(proposalSimilarity(first, second) >= 0.36);
  assert.ok(findDuplicateProposal(second, [comment(first)]));
});

test('assessProposal rejects missing source paths and claimed symbols', () => {
  const repo = mkdtempSync(join(tmpdir(), 'hunter-quality-'));
  mkdirSync(join(repo, 'src'), {recursive: true});
  writeFileSync(join(repo, 'src', 'Valid.ts'), 'export function validFunction() {}\n', 'utf-8');

  const report = assessProposal(
    `
# Proposal
### What is the root cause of that problem?
The function \`inventedFunction\` in \`src/Missing.ts\` fails.
### What changes do you think we should make in order to solve the problem?
Update \`src/Valid.ts\`.
`,
    [],
    repo,
  );

  assert.equal(report.approved, false);
  assert.deepEqual(report.missingPaths, ['src/Missing.ts']);
  assert.deepEqual(report.missingClaimedSymbols, ['inventedFunction']);
});

test('assessProposal approves a source-backed and distinct proposal', () => {
  const repo = mkdtempSync(join(tmpdir(), 'hunter-quality-'));
  mkdirSync(join(repo, 'src'), {recursive: true});
  writeFileSync(join(repo, 'src', 'Valid.ts'), 'export function validFunction() {}\n', 'utf-8');

  const report = assessProposal(
    `
# Proposal
### What is the root cause of that problem?
The function \`validFunction\` in \`src/Valid.ts\` returns too early.
### What changes do you think we should make in order to solve the problem?
Update \`src/Valid.ts\` to preserve the validated state.
`,
    [comment('A proposal about an unrelated navigation animation.')],
    repo,
  );

  assert.equal(report.approved, true);
});

test('assessProposal reports competitor overlap without blocking a source-backed proposal', () => {
  const repo = mkdtempSync(join(tmpdir(), 'hunter-quality-'));
  mkdirSync(join(repo, 'src'), {recursive: true});
  writeFileSync(join(repo, 'src', 'Valid.ts'), 'export function validFunction() {}\n', 'utf-8');
  const proposal = `
# Proposal
### What is the root cause of that problem?
The function \`validFunction\` in \`src/Valid.ts\` returns before metadata is updated.
### What changes do you think we should make in order to solve the problem?
Update \`src/Valid.ts\` so validFunction writes metadata before returning.
`;

  const report = assessProposal(proposal, [comment(proposal)], repo);

  assert.equal(report.approved, true);
  assert.equal(report.duplicateMatch?.author, 'competitor');
});
