import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import type {GitHubComment} from './types.js';

export interface DuplicateMatch {
  author: string;
  commentUrl?: string;
  similarity: number;
}

export interface ProposalQualityReport {
  approved: boolean;
  missingPaths: string[];
  invalidLineReferences: string[];
  missingClaimedSymbols: string[];
  duplicateMatch?: DuplicateMatch;
}

const SOURCE_PATH_PATTERN =
  /(?:https:\/\/github\.com\/Expensify\/App\/blob\/[^/\s]+\/)?((?:src|tests|contributingGuides)\/[A-Za-z0-9_./@+-]+\.(?:ts|tsx|js|jsx|md))/g;
const LINE_REFERENCE_PATTERN =
  /(?:https:\/\/github\.com\/Expensify\/App\/blob\/[^/\s]+\/)?((?:src|tests)\/[A-Za-z0-9_./@+-]+\.(?:ts|tsx|js|jsx))#L(\d+)(?:-L(\d+))?/g;
const CLAIMED_SYMBOL_PATTERNS = [
  /(?:function|hook|method|helper|component|selector)\s+`([A-Za-z_$][A-Za-z0-9_$]{3,})`/gi,
  /(?:calls?|invokes?|uses?|via|through|driven by)\s+`([A-Za-z_$][A-Za-z0-9_$]{3,})`/gi,
  /`([A-Za-z_$][A-Za-z0-9_$]{3,})`\s+(?:function|hook|method|helper|component|selector)/gi,
];

const STOP_WORDS = new Set([
  'about', 'after', 'before', 'being', 'change', 'changes', 'could', 'does', 'existing',
  'expense', 'file', 'from', 'have', 'into', 'issue', 'more', 'should', 'that', 'their',
  'there', 'these', 'this', 'transaction', 'transactions', 'using', 'when', 'where',
  'which', 'with', 'would',
]);

function uniqueMatches(text: string, pattern: RegExp, group = 1): string[] {
  return [...new Set([...text.matchAll(pattern)].map((match) => match[group]))];
}

function extractTechnicalSections(markdown: string): string {
  const rootCause = markdown.match(/What is the root cause[\s\S]*?(?=###?\s+What changes|$)/i)?.[0] ?? '';
  const changes = markdown.match(/What changes[\s\S]*?(?=###?\s+What alternative|$)/i)?.[0] ?? '';
  return `${rootCause}\n${changes}`.trim() || markdown;
}

function technicalTokens(markdown: string): Set<string> {
  const text = extractTechnicalSections(markdown)
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[`*_#()[\]{}.,:;'"|/\\<>+=-]/g, ' ')
    .toLowerCase();

  return new Set(
    text
      .split(/\s+/)
      .filter((token) => token.length >= 4 && !STOP_WORDS.has(token) && !/^\d+$/.test(token)),
  );
}

export function proposalSimilarity(left: string, right: string): number {
  const leftTokens = technicalTokens(left);
  const rightTokens = technicalTokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      intersection++;
    }
  }

  const union = leftTokens.size + rightTokens.size - intersection;
  const jaccard = union === 0 ? 0 : intersection / union;
  const containment = intersection / Math.min(leftTokens.size, rightTokens.size);
  return Math.max(jaccard, containment * 0.72);
}

export function findDuplicateProposal(
  proposal: string,
  comments: GitHubComment[],
  threshold = 0.36,
): DuplicateMatch | undefined {
  let bestMatch: DuplicateMatch | undefined;

  for (const comment of comments) {
    if (!comment.body || !/proposal|root cause|what changes/i.test(comment.body)) {
      continue;
    }

    const similarity = proposalSimilarity(proposal, comment.body);
    if (!bestMatch || similarity > bestMatch.similarity) {
      bestMatch = {
        author: comment.user.login,
        commentUrl: comment.html_url,
        similarity,
      };
    }
  }

  return bestMatch && bestMatch.similarity >= threshold ? bestMatch : undefined;
}

export function assessProposal(
  proposal: string,
  comments: GitHubComment[],
  expensifyPath: string,
): ProposalQualityReport {
  const sourcePaths = uniqueMatches(proposal, SOURCE_PATH_PATTERN);
  const missingPaths = sourcePaths.filter((path) => !existsSync(resolve(expensifyPath, path)));

  const invalidLineReferences: string[] = [];
  for (const match of proposal.matchAll(LINE_REFERENCE_PATTERN)) {
    const [, path, startLineText, endLineText] = match;
    const fullPath = resolve(expensifyPath, path);
    if (!existsSync(fullPath)) {
      continue;
    }
    const lineCount = readFileSync(fullPath, 'utf-8').split('\n').length;
    const startLine = Number(startLineText);
    const endLine = Number(endLineText ?? startLineText);
    if (startLine < 1 || endLine < startLine || endLine > lineCount) {
      invalidLineReferences.push(`${path}#L${startLine}${endLineText ? `-L${endLine}` : ''}`);
    }
  }

  const claimedSymbols = new Set<string>();
  for (const pattern of CLAIMED_SYMBOL_PATTERNS) {
    for (const match of proposal.matchAll(pattern)) {
      claimedSymbols.add(match[1]);
    }
  }

  const missingClaimedSymbols: string[] = [];
  for (const symbol of claimedSymbols) {
    try {
      execFileSync('rg', ['--fixed-strings', '--quiet', '--glob', '*.{ts,tsx,js,jsx}', symbol, 'src'], {
        cwd: expensifyPath,
        stdio: 'ignore',
        timeout: 10000,
      });
    } catch {
      missingClaimedSymbols.push(symbol);
    }
  }

  const duplicateMatch = findDuplicateProposal(proposal, comments);
  const approved =
    sourcePaths.length > 0 &&
    missingPaths.length === 0 &&
    invalidLineReferences.length === 0 &&
    missingClaimedSymbols.length === 0;

  return {
    approved,
    missingPaths,
    invalidLineReferences,
    missingClaimedSymbols,
    duplicateMatch,
  };
}
