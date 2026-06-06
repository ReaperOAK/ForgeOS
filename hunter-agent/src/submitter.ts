import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type {Config} from './config.js';
import {IssueFetcher} from './fetcher.js';
import {assessProposal} from './quality.js';

export interface SubmitResult {
  success: boolean;
  issueNumber: number;
  issueUrl: string;
  url?: string;       // URL of the posted comment, if available
  error?: string;
}

/**
 * Submit a proposal as a comment on the Expensify/App GitHub issue.
 * Uses `gh issue comment` CLI which must be authenticated.
 */
export async function submitProposal(
  issueNumber: number,
  proposalPath: string,
  config: Config,
  issueUrl?: string,
): Promise<SubmitResult> {
  const owner = 'Expensify';
  const repo = 'App';

  // Validate proposal file
  if (!existsSync(proposalPath)) {
    return {
      success: false,
      issueNumber,
      issueUrl: issueUrl ?? `https://github.com/${owner}/${repo}/issues/${issueNumber}`,
      error: `Proposal file not found: ${proposalPath}`,
    };
  }

  const proposalBody = readFileSync(proposalPath, 'utf-8').trim();
  if (!proposalBody || proposalBody.length < 50) {
    return {
      success: false,
      issueNumber,
      issueUrl: issueUrl ?? `https://github.com/${owner}/${repo}/issues/${issueNumber}`,
      error: `Proposal file is empty or too short: ${proposalPath}`,
    };
  }

  const comments = await new IssueFetcher(config).fetchComments(issueNumber);
  const quality = assessProposal(proposalBody, comments, config.expensifyPath);
  if (!quality.approved) {
    return {
      success: false,
      issueNumber,
      issueUrl: issueUrl ?? `https://github.com/${owner}/${repo}/issues/${issueNumber}`,
      error: 'Pre-submit quality gate blocked proposal: source evidence validation failed',
    };
  }

  // Check gh CLI is available
  try {
    execFileSync('gh', ['--version'], { encoding: 'utf-8', timeout: 5000 });
  } catch {
    return {
      success: false,
      issueNumber,
      issueUrl: issueUrl ?? `https://github.com/${owner}/${repo}/issues/${issueNumber}`,
      error: 'gh CLI not found. Install it from https://cli.github.com/',
    };
  }

  // Check gh auth
  try {
    execFileSync('gh', ['auth', 'status'], { encoding: 'utf-8', timeout: 5000 });
  } catch {
    return {
      success: false,
      issueNumber,
      issueUrl: issueUrl ?? `https://github.com/${owner}/${repo}/issues/${issueNumber}`,
      error: 'gh CLI not authenticated. Run: gh auth login',
    };
  }

  console.log(`\n📤 Submitting proposal for #${issueNumber}...`);

  try {
    execFileSync('gh', ['issue', 'comment', String(issueNumber), '--repo', `${owner}/${repo}`, '--body-file', proposalPath], {
      encoding: 'utf-8',
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });

    const issueUrlFull = `https://github.com/${owner}/${repo}/issues/${issueNumber}`;
    console.log(`   ✅ Proposal submitted: ${issueUrlFull}`);

    return {
      success: true,
      issueNumber,
      issueUrl: issueUrlFull,
      url: issueUrlFull,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      issueNumber,
      issueUrl: issueUrl ?? `https://github.com/${owner}/${repo}/issues/${issueNumber}`,
      error: `gh CLI submission failed: ${msg.slice(0, 500)}`,
    };
  }
}

/**
 * Find the most recent proposal file for a given issue number.
 */
export function findProposalFile(outputDir: string, issueNumber: number): string | null {
  const path = resolve(outputDir, `proposal-for-${issueNumber}.md`);
  return existsSync(path) ? path : null;
}
