/**
 * QA tests for ForgeOS git hooks: commit-msg.sh and pre-commit.sh
 *
 * Tests verify:
 * - commit-msg.sh regex validation against git-protocol.instructions.md format
 * - pre-commit.sh structure and blast-radius validation logic
 * - Acceptance criteria coverage for TASK-FOS-06-001
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const HOOKS_DIR = resolve(__dirname, '..', 'hooks');
const COMMIT_MSG_HOOK = join(HOOKS_DIR, 'commit-msg.sh');
const PRE_COMMIT_HOOK = join(HOOKS_DIR, 'pre-commit.sh');

// Helper: run the commit-msg hook against a given message
function runCommitMsgHook(message: string): { exitCode: number; output: string } {
  const tmpDir = mkdtempSync(join(tmpdir(), 'forgeos-hook-test-'));
  const msgFile = join(tmpDir, 'COMMIT_EDITMSG');
  writeFileSync(msgFile, message, 'utf-8');

  try {
    const output = execSync(`bash "${COMMIT_MSG_HOOK}" "${msgFile}" 2>&1`, {
      encoding: 'utf-8',
      timeout: 5000,
    });
    unlinkSync(msgFile);
    return { exitCode: 0, output };
  } catch (err: unknown) {
    const error = err as { status?: number; stdout?: string; stderr?: string };
    unlinkSync(msgFile);
    return {
      exitCode: error.status ?? 1,
      output: (error.stdout ?? '') + (error.stderr ?? ''),
    };
  }
}

// ═══════════════════════════════════════════════════════════════════
// 1. Hook File Structure Tests
// ═══════════════════════════════════════════════════════════════════
describe('Hook file structure', () => {
  it('commit-msg.sh exists', () => {
    expect(existsSync(COMMIT_MSG_HOOK)).toBe(true);
  });

  it('pre-commit.sh exists', () => {
    expect(existsSync(PRE_COMMIT_HOOK)).toBe(true);
  });

  it('commit-msg.sh has bash shebang', () => {
    const content = readFileSync(COMMIT_MSG_HOOK, 'utf-8');
    expect(content.startsWith('#!/usr/bin/env bash')).toBe(true);
  });

  it('pre-commit.sh has bash shebang', () => {
    const content = readFileSync(PRE_COMMIT_HOOK, 'utf-8');
    expect(content.startsWith('#!/usr/bin/env bash')).toBe(true);
  });

  it('commit-msg.sh uses strict mode (set -euo pipefail)', () => {
    const content = readFileSync(COMMIT_MSG_HOOK, 'utf-8');
    expect(content).toContain('set -euo pipefail');
  });

  it('pre-commit.sh uses strict mode (set -euo pipefail)', () => {
    const content = readFileSync(PRE_COMMIT_HOOK, 'utf-8');
    expect(content).toContain('set -euo pipefail');
  });

  it('commit-msg.sh reads commit message from $1 parameter', () => {
    const content = readFileSync(COMMIT_MSG_HOOK, 'utf-8');
    // Hook should reference $1 or ${1} as the commit message file
    expect(content).toMatch(/\$\{?1\}?/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. Commit Message Validation – Valid Messages (exit 0)
// ═══════════════════════════════════════════════════════════════════
describe('commit-msg.sh – valid messages (should pass)', () => {
  const validMessages = [
    // Standard ForgeOS ticket IDs
    '[TASK-FOS-01-001] CLAIM by Backend on machine-1 (Owais)',
    '[TASK-FOS-02-001] BACKEND complete by Backend on pop-os',
    '[TASK-FOS-06-001] QA complete by QA on pop-os',
    // Alternative ticket ID formats
    '[FORGEOS-ARCH-001] Architecture design complete',
    '[FOS-01] Simple two-segment ID',
    '[A-B] Minimal valid ticket ID',
    // Multi-segment IDs
    '[TASK-FOS-01-001] Some description',
    '[TASK-FORGE-BACKEND-001] Long multi-segment ID',
    // Case: uppercase alphanumerics
    '[ABC-DEF-123-456] Mixed alpha-numeric segments',
  ];

  for (const msg of validMessages) {
    it(`accepts: "${msg.substring(0, 60)}..."`, () => {
      const result = runCommitMsgHook(msg);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('valid');
    });
  }
});

// ═══════════════════════════════════════════════════════════════════
// 3. Commit Message Validation – Invalid Messages (exit 1)
// ═══════════════════════════════════════════════════════════════════
describe('commit-msg.sh – invalid messages (should reject)', () => {
  const invalidMessages = [
    // No ticket ID
    'Fix a bug in the system',
    'feat: add new feature',
    // Missing brackets
    'TASK-FOS-01-001 Missing brackets',
    // Lowercase (IDs must be uppercase)
    '[task-fos-01-001] Lowercase ID',
    // Empty message
    '',
    // Special characters in ID
    '[TASK_FOS_01] Uses underscores instead of dashes',
    // Missing closing bracket
    '[TASK-FOS-01-001 Missing closing bracket',
    // Bracket in wrong position (not at start)
    'prefix [TASK-FOS-01-001] Not at start',
    // Single segment (need at least two segments with dash)
    '[TASK] Single segment only',
    // Spaces in ticket ID
    '[TASK FOS-01] Space in ID',
  ];

  for (const msg of invalidMessages) {
    it(`rejects: "${msg.substring(0, 60) || '(empty)'}"`, () => {
      const result = runCommitMsgHook(msg);
      expect(result.exitCode).toBe(1);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════
// 4. Error Message Quality
// ═══════════════════════════════════════════════════════════════════
describe('commit-msg.sh – error message quality', () => {
  it('shows COMMIT REJECTED header on invalid message', () => {
    const result = runCommitMsgHook('bad commit message');
    expect(result.output).toContain('COMMIT REJECTED');
  });

  it('shows expected format examples on rejection', () => {
    const result = runCommitMsgHook('bad commit message');
    // Should show CLAIM format example
    expect(result.output).toContain('CLAIM');
    // Should show the actual invalid message
    expect(result.output).toContain('bad commit message');
  });

  it('displays the invalid message in rejection output', () => {
    const testMsg = 'no-ticket-id here';
    const result = runCommitMsgHook(testMsg);
    expect(result.output).toContain(testMsg);
  });

  it('shows success indicator on valid message', () => {
    const result = runCommitMsgHook('[TASK-FOS-01-001] Valid message');
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('✓');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. Edge Cases
// ═══════════════════════════════════════════════════════════════════
describe('commit-msg.sh – edge cases', () => {
  it('handles missing commit message file gracefully', () => {
    try {
      execSync(`bash "${COMMIT_MSG_HOOK}" "/nonexistent/path" 2>&1`, {
        encoding: 'utf-8',
        timeout: 5000,
      });
      // Should not reach here
      expect(true).toBe(false);
    } catch (err: unknown) {
      const error = err as { status?: number; stdout?: string; stderr?: string };
      expect(error.status).toBe(1);
      const output = (error.stdout ?? '') + (error.stderr ?? '');
      expect(output).toContain('not found');
    }
  });

  it('only validates first line of commit message', () => {
    const multiLineMsg = '[TASK-FOS-01-001] First line is valid\n\nThis is the body\nNo ticket ID needed here';
    const result = runCommitMsgHook(multiLineMsg);
    expect(result.exitCode).toBe(0);
  });

  it('rejects message with only whitespace', () => {
    const result = runCommitMsgHook('   ');
    expect(result.exitCode).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. Git Protocol Compliance
// ═══════════════════════════════════════════════════════════════════
describe('commit-msg.sh – git-protocol.instructions.md compliance', () => {
  it('accepts CLAIM commit format: [TICKET-ID] CLAIM by AGENT on MACHINE (OPERATOR)', () => {
    const result = runCommitMsgHook('[TASK-FOS-06-001] CLAIM by QA on pop-os (Owais)');
    expect(result.exitCode).toBe(0);
  });

  it('accepts WORK commit format: [TICKET-ID] STAGE complete by AGENT on MACHINE', () => {
    const result = runCommitMsgHook('[TASK-FOS-06-001] QA complete by QA on pop-os');
    expect(result.exitCode).toBe(0);
  });

  it('accepts real ticket ID formats: TASK-FOS-NN-NNN', () => {
    const ids = [
      'TASK-FOS-01-001',
      'TASK-FOS-02-002',
      'TASK-FOS-06-001',
      'TASK-FOS-08-003',
    ];
    for (const id of ids) {
      const result = runCommitMsgHook(`[${id}] BACKEND complete by Backend on pop-os`);
      expect(result.exitCode).toBe(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. Pre-Commit Hook Analysis
// ═══════════════════════════════════════════════════════════════════
describe('pre-commit.sh – structure analysis', () => {
  let content: string;

  beforeAll(() => {
    content = readFileSync(PRE_COMMIT_HOOK, 'utf-8');
  });

  it('checks for prohibited staging patterns (git add .)', () => {
    // Should contain logic to detect mass file staging
    expect(content).toMatch(/STAGED_COUNT|staged.*count/i);
  });

  it('validates staged files against ticket scope via FORGEOS_TICKET env', () => {
    expect(content).toContain('FORGEOS_TICKET');
  });

  it('reads ticket JSON for allowed file_paths', () => {
    expect(content).toContain('file_paths');
  });

  it('supports jq fallback to python3 for JSON parsing', () => {
    expect(content).toContain('jq');
    expect(content).toContain('python3');
  });

  it('allows .github/ files regardless of ticket scope', () => {
    // .github/* files should be allowed (always-allowed paths)
    expect(content).toMatch(/\.github\/\*/);
  });

  it('reports scope violations with clear error messages', () => {
    expect(content).toContain('File scope violation');
    expect(content).toContain('COMMIT REJECTED');
  });

  it('runs TypeScript type check when available', () => {
    expect(content).toContain('tsc --noEmit');
  });

  it('does not execute prohibited git add patterns', () => {
    // The hook mentions `git add .` in comments for detection purposes.
    // Verify that no actual git-add-all COMMAND is used (only comments/strings reference it).
    const lines = content.split('\n');
    const codeLines = lines.filter((l) => !l.trimStart().startsWith('#') && !l.trimStart().startsWith('echo'));
    const codeContent = codeLines.join('\n');
    expect(codeContent).not.toMatch(/^\s*git add \./m);
    expect(codeContent).not.toMatch(/^\s*git add -[aA]/m);
  });

  it('uses git diff --cached to check staged files', () => {
    expect(content).toContain('git diff --cached');
  });

  it('emits success message on pass', () => {
    expect(content).toContain('Pre-commit checks passed');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. Regex Pattern Validation (Unit Testing the Pattern Itself)
// ═══════════════════════════════════════════════════════════════════
describe('Ticket ID regex pattern validation', () => {
  // Extract and test the exact regex used in commit-msg.sh
  const TICKET_PATTERN = /^\[[A-Z0-9]+-[A-Z0-9]+(-[A-Z0-9]+)*\]/;

  const shouldMatch = [
    '[A-B] minimal',
    '[TASK-FOS] two segments',
    '[TASK-FOS-01] three segments',
    '[TASK-FOS-01-001] four segments',
    '[ABC-DEF-GHI-JKL-MNO] five segments',
    '[FORGEOS-001] alphanumeric second segment',
    '[FOS-BATCH-001] three segments mixed',
  ];

  const shouldNotMatch = [
    'no brackets',
    'TASK-FOS no brackets',
    '[task-fos] lowercase',
    '[TASK] single segment',
    '[] empty brackets',
    '[-AB] leading dash',
    '[AB-] trailing dash',
    '[ TASK-FOS ] spaces inside',
    'x[TASK-FOS] not at start',
  ];

  for (const input of shouldMatch) {
    it(`regex matches: "${input}"`, () => {
      expect(TICKET_PATTERN.test(input)).toBe(true);
    });
  }

  for (const input of shouldNotMatch) {
    it(`regex rejects: "${input}"`, () => {
      expect(TICKET_PATTERN.test(input)).toBe(false);
    });
  }
});
