import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import type { Config } from './config.js';
import type { GitHubIssue, GitHubComment } from './types.js';

/**
 * Deep investigation engine — collects exhaustive context about a bug.
 * Goes WAY beyond simple grep:
 *  - Recursive symbol expansion (callers, callees, types)
 *  - Git blame & PR history for cited files
 *  - Similar bug retrieval from closed issues
 *  - File content with surgical focus around relevant symbols
 */
export class Investigator {
  constructor(private config: Config) {}

  /** Run a shell command in the Expensify repo, return trimmed output. */
  private sh(cmd: string, timeoutMs = 20000, maxBuffer = 2 * 1024 * 1024): string {
    try {
      return execSync(cmd, {
        cwd: this.config.expensifyPath,
        encoding: 'utf-8',
        timeout: timeoutMs,
        maxBuffer,
      }).trim();
    } catch (err) {
      return '';
    }
  }

  // ── 1. Issue Structural Parsing ────────────────────────────────────

  parseIssue(issue: GitHubIssue): {
    actionPerformed: string;
    expectedResult: string;
    actualResult: string;
    platforms: string[];
    bountyAmount: string;
    screenshots: string[];
    videos: string[];
  } {
    const body = issue.body ?? '';
    const lower = body.toLowerCase();

    // Extract structured sections (Expensify uses headers like "Action Performed:")
    const section = (label: string): string => {
      const re = new RegExp(`(?:###?\\s*)?(?:\\*\\*)?${label}(?:\\*\\*)?[:\\s]*\\n([\\s\\S]+?)(?=\\n(?:###?\\s*)?(?:\\*\\*)?(?:Action|Expected|Actual|Workaround|Platform|Version|Reproducible|Logs|Notes|Reproducing|Details)|$)`, 'i');
      const m = body.match(re);
      return m ? m[1].trim().slice(0, 1500) : '';
    };

    const actionPerformed = section('Action Performed') || section('Steps to Reproduce') || section('Reproducing the issue');
    const expectedResult = section('Expected Result') || section('Expected behavior');
    const actualResult = section('Actual Result') || section('Actual behavior');

    // Platforms
    const platforms: string[] = [];
    if (lower.includes('android')) platforms.push('Android');
    if (lower.includes('ios') || lower.includes('iphone')) platforms.push('iOS');
    if (lower.includes('web') || lower.includes('chrome') || lower.includes('firefox') || lower.includes('safari')) platforms.push('Web');
    if (lower.includes('desktop') || lower.includes('electron') || lower.includes('macos')) platforms.push('Desktop');
    if (lower.includes('mweb') || lower.includes('mobile web')) platforms.push('mWeb');

    // Bounty
    const bountyMatch = body.match(/\$(\d{2,5})/);
    const bountyAmount = bountyMatch ? `$${bountyMatch[1]}` : 'unknown';

    // Screenshots/videos
    const screenshots = [...body.matchAll(/!\[[^\]]*\]\(([^)]+\.(?:png|jpg|jpeg|gif|webp))[^)]*\)/gi)].map(m => m[1]);
    const videos = [...body.matchAll(/\((https?:\/\/[^\s)]+\.(?:mp4|webm|mov)[^\s)]*)\)/gi)].map(m => m[1])
      .concat([...body.matchAll(/(https?:\/\/[^\s]+\.(?:mp4|webm|mov))/gi)].map(m => m[1]));

    return {
      actionPerformed,
      expectedResult,
      actualResult,
      platforms: [...new Set(platforms)],
      bountyAmount,
      screenshots: [...new Set(screenshots)].slice(0, 5),
      videos: [...new Set(videos)].slice(0, 3),
    };
  }

  // ── 2. Keyword Extraction (expanded) ───────────────────────────────

  extractKeywords(issue: GitHubIssue): {
    hooks: string[];
    components: string[];
    constants: string[];
    onyxKeys: string[];
    filePaths: string[];
    quotedStrings: string[];
    translationKeys: string[];
  } {
    const body = issue.body ?? '';
    const title = issue.title ?? '';
    const all = title + '\n' + body;

    const extractUnique = (re: RegExp): string[] =>
      [...new Set([...all.matchAll(re)].map(m => m[0]))];

    const hooks = extractUnique(/\buse[A-Z][a-zA-Z]+\b/g);
    const components = extractUnique(/\b[A-Z][a-zA-Z]+[A-Z][a-zA-Z]+\b/g)
      .filter(c => !['CONST', 'ONYXKEYS', 'API', 'URL', 'HTML', 'JSON', 'OK', 'NEW', 'PR'].includes(c));
    const constants = extractUnique(/\bCONST\.[A-Z_.]+/g);
    const onyxKeys = extractUnique(/\bONYXKEYS?\.[A-Z_]+/g);
    const filePaths = extractUnique(/(?:src|tests|assets)\/[a-zA-Z0-9_/.\-]+\.(?:ts|tsx|js|jsx)/g);
    const quotedStrings = extractUnique(/"([a-z][a-zA-Z0-9._]*)"/g)
      .filter(s => s.length > 5 && s.length < 80)
      .slice(0, 10);

    // Translation keys are typically dot-notation strings: 'common.action', 'iou.paidElsewhere'
    const translationKeys = extractUnique(/['"`]([a-z]+(?:\.[a-zA-Z]+){1,4})['"`]/g)
      .map(s => s.replace(/['"`]/g, ''))
      .filter(s => /^[a-z]+\.[a-zA-Z]/.test(s));

    return { hooks, components, constants, onyxKeys, filePaths, quotedStrings, translationKeys };
  }

  // ── 3. Recursive Codebase Search ────────────────────────────────────

  /** Grep across the codebase, return matched files + line numbers. */
  grep(pattern: string, maxResults = 15, includeGlob?: string): { file: string; line: number; text: string }[] {
    const includeArg = includeGlob ? `--include="${includeGlob}"` : '--include="*.ts" --include="*.tsx"';
    const cmd = `grep -rn ${includeArg} --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=android --exclude-dir=ios -- "${pattern.replace(/"/g, '\\"')}" src/ 2>/dev/null | head -${maxResults}`;
    const output = this.sh(cmd);
    if (!output) return [];

    const results: { file: string; line: number; text: string }[] = [];
    for (const line of output.split('\n')) {
      const m = line.match(/^([^:]+):(\d+):(.*)$/);
      if (m) results.push({ file: m[1], line: parseInt(m[2], 10), text: m[3].trim() });
    }
    return results;
  }

  /** Find all references to a symbol (callers). */
  findReferences(symbol: string, maxResults = 10): { file: string; line: number; text: string }[] {
    return this.grep(`\\b${symbol}\\b`, maxResults);
  }

  /** Find the definition of a function/const/class. */
  findDefinition(symbol: string): { file: string; line: number; text: string } | null {
    const patterns = [
      `function ${symbol}`,
      `const ${symbol}`,
      `class ${symbol}`,
      `export function ${symbol}`,
      `export const ${symbol}`,
      `export default function ${symbol}`,
      `${symbol}:`,
    ];
    for (const p of patterns) {
      const results = this.grep(p, 3);
      if (results.length > 0) return results[0];
    }
    return null;
  }

  /** Read a file with optional line range. */
  readFile(relativePath: string, startLine?: number, endLine?: number): string {
    const full = resolve(this.config.expensifyPath, relativePath);
    if (!existsSync(full)) return '';
    try {
      const content = readFileSync(full, 'utf-8');
      const lines = content.split('\n');
      const start = startLine ? Math.max(0, startLine - 1) : 0;
      const end = endLine ? Math.min(lines.length, endLine) : Math.min(lines.length, start + 250);
      return lines.slice(start, end).map((l, i) => `${start + i + 1}: ${l}`).join('\n');
    } catch {
      return '';
    }
  }

  /** Read a focused window around a specific line (±N lines). */
  readWindow(relativePath: string, centerLine: number, halfWindow = 40): string {
    return this.readFile(relativePath, Math.max(1, centerLine - halfWindow), centerLine + halfWindow);
  }

  // ── 4. Git Blame & PR History ──────────────────────────────────────

  blame(file: string, line: number): { commit: string; author: string; date: string; summary: string } | null {
    const cmd = `git -C "${this.config.expensifyPath}" log -L ${line},${line}:${file} --pretty=format:'%h|%an|%ad|%s' --date=short -n 1 2>/dev/null`;
    const output = this.sh(cmd, 10000);
    const m = output.match(/^([a-f0-9]+)\|([^|]+)\|([^|]+)\|(.+)$/);
    if (!m) return null;
    return { commit: m[1], author: m[2], date: m[3], summary: m[4] };
  }

  /** Get the PR that introduced a given commit (if accessible via `git log`). */
  recentPRsForFile(file: string, limit = 5): string[] {
    const cmd = `git -C "${this.config.expensifyPath}" log --oneline -n ${limit} -- "${file}" 2>/dev/null`;
    const output = this.sh(cmd, 10000);
    return output ? output.split('\n').filter(Boolean) : [];
  }

  // ── 5. Translation Key Lookup ──────────────────────────────────────

  /** For Expensify, translation keys live in src/languages/en.ts */
  findTranslation(key: string): string {
    const enFile = resolve(this.config.expensifyPath, 'src/languages/en.ts');
    if (!existsSync(enFile)) return '';
    try {
      const content = readFileSync(enFile, 'utf-8');
      // Try to find the key (e.g., 'iou.paidElsewhere')
      const parts = key.split('.');
      const escaped = parts[parts.length - 1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`${escaped}[:\\s]+['"\`]([^'"\`]{1,200})['"\`]`);
      const m = content.match(re);
      return m ? m[1] : '';
    } catch {
      return '';
    }
  }

  // ── 6. Comment Analysis ────────────────────────────────────────────

  analyzeComments(comments: GitHubComment[]): {
    competitorProposals: GitHubComment[];
    triageNotes: GitHubComment[];
    melvinBot: GitHubComment | null;
  } {
    const competitorProposals = comments
      .filter(c => c.body && (
        c.body.includes('# Proposal') ||
        c.body.includes('## Proposal') ||
        c.body.includes('### Please re-state') ||
        /What is the root cause/i.test(c.body)
      ))
      .filter(c => c.user.login !== 'melvin-bot[bot]')
      .slice(0, 5);

    const triageNotes = comments
      .filter(c => /triage|deploy block|external|priority|assign|cc @/i.test(c.body ?? ''))
      .slice(0, 3);

    const melvinBot = comments.find(c => c.user.login.startsWith('melvin-bot')) ?? null;

    return { competitorProposals, triageNotes, melvinBot };
  }

  // ── 7. Build Investigation Report ──────────────────────────────────

  async buildContext(issue: GitHubIssue, comments: GitHubComment[]): Promise<string> {
    const sections: string[] = [];

    // 1. Parsed Issue
    const parsed = this.parseIssue(issue);
    sections.push(`# ISSUE METADATA`);
    sections.push(`- **Number:** #${issue.number}`);
    sections.push(`- **Title:** ${issue.title}`);
    sections.push(`- **Bounty:** ${parsed.bountyAmount}`);
    sections.push(`- **Platforms:** ${parsed.platforms.join(', ') || 'unspecified'}`);
    sections.push(`- **Labels:** ${issue.labels.map(l => l.name).join(', ')}`);
    sections.push(`- **URL:** ${issue.html_url}`);

    sections.push(`\n## STRUCTURED BUG REPORT`);
    sections.push(`### Action Performed\n${parsed.actionPerformed || '(not clearly stated in issue)'}`);
    sections.push(`### Expected Result\n${parsed.expectedResult || '(not clearly stated)'}`);
    sections.push(`### Actual Result\n${parsed.actualResult || '(not clearly stated)'}`);
    if (parsed.screenshots.length > 0) {
      sections.push(`### Visual Evidence`);
      sections.push(`Screenshots in issue: ${parsed.screenshots.length}`);
      parsed.screenshots.forEach(s => sections.push(`- ${s}`));
    }
    if (parsed.videos.length > 0) {
      sections.push(`### Video Reproductions: ${parsed.videos.length}`);
      parsed.videos.forEach(v => sections.push(`- ${v}`));
    }

    sections.push(`\n## RAW ISSUE BODY`);
    sections.push(issue.body?.slice(0, 4000) ?? '(empty)');

    // 2. Keyword extraction
    const kw = this.extractKeywords(issue);
    sections.push(`\n# EXTRACTED SYMBOLS`);
    if (kw.hooks.length > 0) sections.push(`- **Hooks:** ${kw.hooks.join(', ')}`);
    if (kw.components.length > 0) sections.push(`- **Components:** ${kw.components.slice(0, 15).join(', ')}`);
    if (kw.constants.length > 0) sections.push(`- **CONST refs:** ${kw.constants.join(', ')}`);
    if (kw.onyxKeys.length > 0) sections.push(`- **Onyx keys:** ${kw.onyxKeys.join(', ')}`);
    if (kw.filePaths.length > 0) sections.push(`- **Mentioned files:** ${kw.filePaths.join(', ')}`);
    if (kw.translationKeys.length > 0) sections.push(`- **Translation keys:** ${kw.translationKeys.join(', ')}`);

    // 3. Translation key lookups
    if (kw.translationKeys.length > 0) {
      sections.push(`\n# TRANSLATION KEY VALUES (from src/languages/en.ts)`);
      for (const key of kw.translationKeys.slice(0, 8)) {
        const val = this.findTranslation(key);
        if (val) sections.push(`- \`${key}\` → "${val}"`);
      }
    }

    // 4. Search for symbol definitions
    const symbolsToSearch = [...kw.hooks, ...kw.components.slice(0, 10)];
    const foundDefinitions: { symbol: string; def: { file: string; line: number; text: string } }[] = [];
    sections.push(`\n# SYMBOL DEFINITIONS FOUND`);
    for (const sym of symbolsToSearch) {
      const def = this.findDefinition(sym);
      if (def) {
        foundDefinitions.push({ symbol: sym, def });
        sections.push(`\n## ${sym}`);
        sections.push(`- **File:** ${def.file}:${def.line}`);
        sections.push(`- **Line:** \`${def.text}\``);
        const blame = this.blame(def.file, def.line);
        if (blame) {
          sections.push(`- **Last touched by:** ${blame.author} (${blame.date}) — "${blame.summary}"`);
        }
      }
    }

    // 5. Read focused windows of files referenced in issue
    const filesToRead = new Set<string>([...kw.filePaths]);
    for (const fd of foundDefinitions.slice(0, 6)) {
      filesToRead.add(fd.def.file.replace(this.config.expensifyPath + '/', ''));
    }

    sections.push(`\n# SOURCE CODE WINDOWS`);
    let filesRead = 0;
    for (const file of filesToRead) {
      if (filesRead >= 10) break;
      const fd = foundDefinitions.find(d => d.def.file.endsWith(file) || file.endsWith(d.def.file));
      if (fd) {
        // Read ±60 lines around the symbol definition
        sections.push(`\n## ${file} (around line ${fd.def.line} — ${fd.symbol})`);
        sections.push('```typescript');
        sections.push(this.readWindow(file, fd.def.line, 60));
        sections.push('```');
      } else {
        // Read first 250 lines of the file
        const content = this.readFile(file, 1, 250);
        if (content) {
          sections.push(`\n## ${file} (first 250 lines)`);
          sections.push('```typescript');
          sections.push(content);
          sections.push('```');
        }
      }
      filesRead++;
    }

    // 6. Expand: read references for top 3 hooks/components
    sections.push(`\n# CROSS-REFERENCES (where key symbols are called)`);
    for (const sym of symbolsToSearch.slice(0, 5)) {
      const refs = this.findReferences(sym, 8);
      if (refs.length > 1) {
        sections.push(`\n## ${sym} — ${refs.length} usages`);
        for (const r of refs.slice(0, 8)) {
          sections.push(`- \`${r.file}:${r.line}\` → ${r.text.slice(0, 120)}`);
        }
      }
    }

    // 7. Git history for cited files
    sections.push(`\n# RECENT COMMITS TOUCHING RELEVANT FILES`);
    for (const file of [...filesToRead].slice(0, 5)) {
      const commits = this.recentPRsForFile(file, 5);
      if (commits.length > 0) {
        sections.push(`\n## ${file}`);
        commits.forEach(c => sections.push(`- ${c}`));
      }
    }

    // 8. Comment analysis
    const analyzed = this.analyzeComments(comments);
    if (analyzed.competitorProposals.length > 0) {
      sections.push(`\n# COMPETITOR PROPOSALS (analyze for flaws)`);
      sections.push(`There are ${analyzed.competitorProposals.length} competing proposals already posted. Read them carefully and find their weaknesses, missed edge cases, or incorrect root causes.`);
      analyzed.competitorProposals.forEach((c, i) => {
        sections.push(`\n## Competitor ${i + 1}: ${c.user.login} (${c.created_at})`);
        sections.push(c.body.slice(0, 2500));
      });
    } else {
      sections.push(`\n# COMPETITOR PROPOSALS`);
      sections.push(`No proposals yet — you have the first-mover advantage. Make it count.`);
    }

    if (analyzed.triageNotes.length > 0) {
      sections.push(`\n# TRIAGE / INTERNAL NOTES`);
      analyzed.triageNotes.forEach(c => {
        sections.push(`- ${c.user.login}: ${c.body?.slice(0, 300)}`);
      });
    }

    return sections.join('\n');
  }
}
