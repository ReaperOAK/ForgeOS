import type { Config } from './config.js';
import { IssueFetcher } from './fetcher.js';
import { Investigator } from './investigator.js';
import { makeToolDefinitions, ToolExecutor } from './tools.js';
import {assessProposal, type ProposalQualityReport} from './quality.js';
import {prepareExpensifyRepository} from './repository.js';
import type { GitHubIssue, GitHubComment, Proposal, ChatMessage, OpenRouterChunk } from './types.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export class Analyzer {
  private fetcher: IssueFetcher;
  private investigator: Investigator;
  private toolExecutor: ToolExecutor;
  private toolDefs = makeToolDefinitions();

  constructor(private config: Config) {
    this.fetcher = new IssueFetcher(config);
    this.investigator = new Investigator(config);
    this.toolExecutor = new ToolExecutor(config);
  }

  /** Analyze a specific issue by number */
  async analyzeIssue(issueNumber: number): Promise<Proposal | null> {
    const issue = await this.fetcher.fetchByNumber(issueNumber);
    const comments = await this.fetcher.fetchComments(issueNumber);
    return this.analyze(issue, comments);
  }

  /** Analyze the latest Help Wanted issue */
  async analyzeLatest(): Promise<Proposal | null> {
    const issue = await this.fetcher.fetchLatest();
    if (!issue) {
      console.log('No open Help Wanted issues found.');
      return null;
    }
    const exists = await this.proposalExists(issue.number);
    if (exists) {
      console.log(`Proposal already exists for #${issue.number} — skipping.`);
      return null;
    }
    const comments = await this.fetcher.fetchComments(issue.number);
    return this.analyze(issue, comments);
  }

  /**
   * Source-backed proposal pipeline:
   *   Stage 1: Autonomous repository investigation with file and git tools
   *   Stage 2: Root-cause hypothesis (LLM reasons step-by-step)
   *   Stage 3: Draft proposal (LLM writes initial proposal)
   *   Stage 4: Self-critique (LLM finds flaws in its own draft)
   *   Stage 5: Final proposal (LLM rewrites and addresses critique)
   *   Stage 6: Competitor differentiation when technical overlap is high
   */
  private async analyze(issue: GitHubIssue, comments: GitHubComment[]): Promise<Proposal | null> {
    console.log(`\n🔍 Investigating Expensify/App issue #${issue.number}: "${issue.title}"`);

    console.log(`   [Preflight] Verifying Expensify checkout...`);
    prepareExpensifyRepository(this.config);

    // ── Stage 1: Deterministic code investigation ─────────────────
    console.log(`   [Stage 1] Investigating codebase with grep, git blame & symbol resolution...`);
    const fullContext = await this.investigator.buildContext(issue, comments);
    const contextSize = Math.round(fullContext.length / 4);
    console.log(`   [Stage 1] Context: ${fullContext.length} chars (~${contextSize} tokens)`);

    // ── Stage 2: Root-cause reasoning ──────────────────────────────
    console.log(`   [Stage 2] Reasoning about root cause...`);
    const hypothesis = await this.generateHypothesis(issue, fullContext);
    console.log(`   [Stage 2] Hypothesis: ${hypothesis.slice(0, 120).replace(/\n/g, ' ')}...`);

    // ── Stage 3: Draft proposal ────────────────────────────────────
    console.log(`   [Stage 3] Drafting proposal...`);
    let draft = await this.draftProposal(issue, fullContext, hypothesis);
    if (!draft || draft.length < 100) {
      console.log(`   [Stage 3] Draft empty, writing proposal directly from context...`);
      draft = await this.finalProposal(issue, fullContext, hypothesis, '', 'No draft was generated. Write the full proposal from scratch.', comments);
      console.log(`   [Stage 3] Direct proposal: ${draft.length} chars`);
      // Fall through to quality gate instead of returning early
    }
    console.log(`   [Stage 3] Draft: ${draft.length} chars`);

    // ── Stage 4: Self-critique ─────────────────────────────────────
    console.log(`   [Stage 4] Self-critique...`);
    const critique = await this.critiqueDraft(issue, fullContext, draft);
    console.log(`   [Stage 4] Critique: ${critique.slice(0, 120).replace(/\n/g, ' ')}...`);

    // ── Stage 5: Final polished proposal ───────────────────────────
    console.log(`   [Stage 5] Writing final proposal...`);
    const latestComments = await this.fetcher.fetchComments(issue.number);
    let final = await this.finalProposal(issue, fullContext, hypothesis, draft, critique, latestComments);
    console.log(`   [Stage 5] Final: ${final.length} chars`);

    if (!final || final.length < 200) {
      this.saveRejectedProposal(issue, final || draft, {
        approved: false,
        missingPaths: [],
        invalidLineReferences: [],
        missingClaimedSymbols: [],
      }, 'Generated proposal was empty or too short.');
      return null;
    }

    let quality = assessProposal(final, latestComments, this.config.expensifyPath);
    if (quality.duplicateMatch) {
      const closestComment = latestComments.find((comment) => comment.html_url === quality.duplicateMatch?.commentUrl);
      if (closestComment) {
        console.log(`   [Stage 6] Strengthening differentiation from @${quality.duplicateMatch.author}...`);
        final = await this.differentiateProposal(issue, fullContext, final, closestComment);
        quality = assessProposal(final, latestComments, this.config.expensifyPath);
      }
    }

    console.log(`   [Quality Gate] Validating source evidence...`);
    if (!quality.approved) {
      this.saveRejectedProposal(issue, final, quality, 'Proposal failed source-evidence checks.');
      return null;
    }
    if (quality.duplicateMatch) {
      console.log(
        `   [Competition Check] Closest proposal: @${quality.duplicateMatch.author} (${Math.round(quality.duplicateMatch.similarity * 100)}% overlap).`,
      );
    }

    return this.saveProposal(issue, final, 0);
  }

  private async differentiateProposal(
    issue: GitHubIssue,
    context: string,
    proposal: string,
    closestCompetitor: GitHubComment,
  ): Promise<string> {
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `Rewrite the proposal so it provides a material technical improvement over the closest existing proposal.

Keep the standard Expensify proposal format. Preserve correct shared observations, but add only source-backed value from the investigation:
- a more exact state/data-flow explanation
- corrected path, symbol, or patch location
- a narrower implementation
- missing edge cases or regression guards
- concrete tests that distinguish the fix

Do not invent APIs or broaden scope merely to look different. Do not mention similarity scores or proposal policing.`,
      },
      {
        role: 'user',
        content: `# Issue #${issue.number}: ${issue.title}

## Investigation evidence
${context}

## Current proposal
${proposal}

## Closest existing proposal by @${closestCompetitor.user.login}
${closestCompetitor.body?.slice(0, 5000)}

Rewrite the current proposal so its added technical contribution is unmistakable and fully supported by the investigation evidence.`,
      },
    ];
    const response = await this.callLLM(messages, false);
    return this.extractText(response) || proposal;
  }

  /** Stage 2: LLM reasons step-by-step about the root cause. */
  private async generateHypothesis(issue: GitHubIssue, context: string): Promise<string> {
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `You are an elite React Native / Next.js architect debugging a complex bug in the Expensify/App codebase.

Your task: REASON about the root cause. Think step-by-step. Be specific.

Output format:
1. **Bug behavior:** What is broken (1 sentence)
2. **Affected user journey:** Which code path triggers the bug (2-3 sentences with file paths)
3. **State / data flow:** Trace what data is wrong, where it diverges from expected
4. **Root cause hypothesis:** The MOST LIKELY cause, with exact file + function + line number
5. **Confidence:** HIGH / MEDIUM / LOW with reasoning

Be RUTHLESSLY specific. Cite file paths from the context. If you're guessing, say so.`,
      },
      {
        role: 'user',
        content: `Investigation context for issue #${issue.number}:\n\n${context}\n\nNow reason about the root cause.`,
      },
    ];
    const response = await this.callLLM(messages, false);
    return this.extractText(response);
  }

  /** Stage 3: Write a first-draft proposal. */
  private async draftProposal(issue: GitHubIssue, context: string, hypothesis: string): Promise<string> {
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `You are writing an Expensify bug bounty proposal. Write a complete proposal in EXACTLY this format:

# Proposal

### Please re-state the problem that we are trying to solve in this issue.
(1-2 sentences, synthesized from issue, not copy-pasted)

### What is the root cause of that problem?
(Exact file paths with line numbers. Specific function names. Show the broken code if helpful.)

### What changes do you think we should make in order to solve the problem?
(Exact file paths. Show surgical code changes with before/after blocks or pseudo-diffs.
Explain WHY this fix works and what regressions it could cause.)

### What alternative solutions did you explore? (Optional)
(Discuss alternative approaches, explain why your main solution is better.)

Rules:
- Be SURGICAL. No generic advice. Cite exact files & functions from the investigation.
- Use real code from the codebase context, not invented APIs.
- If you cite a line number, it must match what's in the context.`,
      },
      {
        role: 'user',
        content: `Hypothesis from analysis:\n${hypothesis}\n\n---\n\nFull investigation context:\n${context}\n\n---\n\nWrite the complete proposal now.`,
      },
    ];
    const response = await this.callLLM(messages, false);
    return this.extractText(response);
  }

  /** Stage 4: LLM critiques its own draft for flaws. */
  private async critiqueDraft(issue: GitHubIssue, context: string, draft: string): Promise<string> {
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `You are a SENIOR Expensify engineer reviewing a bug bounty proposal critically. Find every flaw.

Look for:
- **Wrong file paths or line numbers** — does the cited code actually exist in the context?
- **Invented APIs / function signatures** — do the cited functions exist as described?
- **Missed edge cases** — empty states, error paths, race conditions, undefined values
- **Wrong root cause** — would this fix actually solve the bug, or just mask a symptom?
- **Regression risk** — would this change break OTHER flows? Which ones?
- **Cross-platform bugs** — does it work on iOS, Android, Web, mWeb, Desktop?
- **Onyx / state subtleties** — does the proposal handle Onyx pendingActions, optimistic updates, server reconciliation?
- **Translation / i18n** — does it handle the en.ts key correctly?
- **Type safety** — would TypeScript complain about the proposed change?
- **Better alternative** — is there a more elegant fix the author missed?

Output: bullet list of CONCRETE issues with the draft, ordered by severity. Be honest. If draft is solid, say so explicitly with reasoning.`,
      },
      {
        role: 'user',
        content: `Investigation context (the source of truth):\n${context.slice(0, 50000)}\n\n---\n\nDraft proposal to critique:\n${draft}\n\n---\n\nCritique it harshly.`,
      },
    ];
    const response = await this.callLLM(messages, false);
    return this.extractText(response);
  }

  /** Stage 5: Final polished proposal that addresses critique and attacks competitors. */
  private async finalProposal(
    issue: GitHubIssue,
    context: string,
    hypothesis: string,
    draft: string,
    critique: string,
    comments: GitHubComment[],
  ): Promise<string> {
    const competitorProposals = comments
      .filter(c => c.body && (c.body.includes('# Proposal') || c.body.includes('## Proposal') || /What is the root cause/i.test(c.body)))
      .filter(c => c.user.login !== 'melvin-bot[bot]')
      .slice(0, 12);

    const competitorBlock = competitorProposals.length > 0
      ? `\n\nExisting proposals to improve upon. Preserve correct parts, but add verified evidence, narrower changes, or missed regressions rather than paraphrasing them:\n${competitorProposals.map((c, i) => `\n### Competitor ${i + 1} (${c.user.login}):\n${c.body?.slice(0, 3000)}`).join('\n')}`
      : '\n\nNo competitor proposals yet — you have first-mover advantage.';

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `You are writing the final Expensify bug bounty proposal. It must be more useful than existing proposals because it is better verified, more precise, and safer to implement.

OUTPUT EXACTLY this format (no extra commentary, no preamble):

# Proposal

### Please re-state the problem that we are trying to solve in this issue.
(1-2 sentences. Synthesize the user-facing failure. Don't copy-paste the issue.)

### What is the root cause of that problem?
(Exact file paths AND line numbers. Specific function names. Quote the broken code in a code block.
Explain the data flow / state machine that fails.
If multiple files contribute, list them all.)

### What changes do you think we should make in order to solve the problem?
(For each file to change:
  1. File path
  2. Before/after code blocks or pseudo-diff
  3. Required imports (if any)
  4. Why this works
  5. What regressions it avoids
Use real types and function signatures from the codebase context, not invented ones.
Be surgical — don't propose larger refactors unless absolutely necessary.)

### What alternative solutions did you explore? (Optional)
(This is your CHANCE TO BEAT COMPETITORS:
- If competing proposals exist, preserve their correct observations but state the concrete evidence or implementation detail your proposal adds.
- If no competitors, discuss 1-2 plausible alternative approaches and explain why your main solution is superior.
- Cover regressions, edge cases, and platform-specific gotchas your competitors missed.)

CRITICAL RULES:
- Every file path you cite MUST appear in the investigation context.
- Every function name you cite MUST exist in the codebase context.
- If the critique pointed out an error, FIX IT — don't repeat the same mistake.
- Do not paraphrase an existing proposal. Add a verified technical contribution: a corrected root cause, narrower patch location, missing state transition, test plan, or regression analysis.
- Be technical, terse, and confident. No filler. No marketing speak.`,
      },
      {
        role: 'user',
        content: `# Issue #${issue.number}: ${issue.title}
URL: ${issue.html_url}

# Your prior reasoning:
${hypothesis}

# Your draft proposal:
${draft}

# Senior engineer's critique of your draft:
${critique}

# Full investigation context (source of truth for file paths and code):
${context}${competitorBlock}

---

Write the FINAL proposal. Address every valid point in the critique. Beat every competitor. Be surgical.`,
      },
    ];
    const response = await this.callLLM(messages, false);
    return this.extractText(response);
  }

  /** Call OpenRouter streaming API */
  private async callLLM(messages: ChatMessage[], includeTools: boolean = true): Promise<{
    choices: { delta: any; finish_reason: string | null }[];
    error?: { message: string };
  }> {
    const url = 'https://openrouter.ai/api/v1/chat/completions';

    const body: any = {
      model: this.config.model,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
        tool_calls: m.tool_calls,
        tool_call_id: m.tool_call_id,
      })),
      stream: true,
    };

    // Only include max_tokens when explicitly set (> 0)
    if (this.config.maxOutputTokens > 0) {
      body.max_tokens = this.config.maxOutputTokens;
    }

    // Only include tools in Phase 1 (investigation)
    if (includeTools) {
      body.tools = this.toolDefs;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.openrouterApiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/ReaperOAK/ForgeOS',
        'X-Title': 'ForgeOS Hunter Agent',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter HTTP ${response.status}: ${errorText.slice(0, 500)}`);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    let combinedDelta: any = {};
    let finishReason: string | null = null;
    let error: { message: string } | undefined;

    // Accumulate tool_calls from chunks
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n').filter(l => l.startsWith('data: '));

      for (const line of lines) {
        const json = line.slice(6).trim();
        if (!json || json === '[DONE]') continue;

        try {
          const parsed = JSON.parse(json) as OpenRouterChunk;
          if (parsed.error) { error = parsed.error; break; }
          if (!parsed.choices?.[0]) continue;

          const choice = parsed.choices[0];
          finishReason = choice.finish_reason ?? finishReason;
          const delta = choice.delta;

          if (!delta) continue;

          // Merge tool_calls arrays
          if (delta.tool_calls) {
            if (!combinedDelta.tool_calls) combinedDelta.tool_calls = [];
            for (const tc of delta.tool_calls) {
              const existing = combinedDelta.tool_calls.findIndex((e: any) => e.index === tc.index);
              if (existing >= 0) {
                // Merge into existing
                const existingTc = combinedDelta.tool_calls[existing];
                if (tc.function) {
                  existingTc.function = existingTc.function || { name: '', arguments: '' };
                  if (tc.function.name) existingTc.function.name += tc.function.name;
                  if (tc.function.arguments) existingTc.function.arguments += tc.function.arguments;
                }
                if (tc.id) existingTc.id = tc.id;
              } else {
                combinedDelta.tool_calls.push({
                  index: tc.index,
                  id: tc.id || '',
                  type: 'function',
                  function: { name: '', arguments: '' },
                  ...tc.function ? { function: { name: tc.function.name || '', arguments: tc.function.arguments || '' } } : {},
                });
              }
            }
          }

          // Merge content
          if (delta.content) {
            combinedDelta.content = (combinedDelta.content || '') + delta.content;
          }

          // Capture usage from final chunk
          if (parsed.usage) {
            // Non-standard, but some models send usage in-stream
          }
        } catch {
          // Skip parse errors on incomplete chunks
        }
      }
    }

    return {
      choices: [{ delta: combinedDelta, finish_reason: finishReason }],
      error,
    };
  }

  private extractText(response: { choices: { delta: any; finish_reason: string | null }[] }): string {
    const deltas = response.choices.map(c => c.delta?.content ?? '').filter(Boolean);
    return deltas.join('');
  }

  private async proposalExists(issueNumber: number): Promise<boolean> {
    const filePath = resolve(this.config.outputDir, `proposal-for-${issueNumber}.md`);
    return existsSync(filePath);
  }

  private saveProposal(issue: GitHubIssue, body: string, toolCalls: number): Proposal {
    const dir = this.config.outputDir;
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const filePath = resolve(dir, `proposal-for-${issue.number}.md`);
    writeFileSync(filePath, body, 'utf-8');

    const proposal: Proposal = {
      issueNumber: issue.number,
      issueTitle: issue.title,
      issueUrl: issue.html_url,
      body,
      generatedAt: new Date().toISOString(),
      model: this.config.model,
      toolCalls,
      filePath,
    };

    console.log(`\n📝 Proposal saved: ${filePath}`);
    console.log(`   Issue: #${issue.number} — ${issue.title}`);
    console.log(`   Tool calls: ${toolCalls}`);

    return proposal;
  }

  private saveRejectedProposal(
    issue: GitHubIssue,
    body: string,
    quality: ProposalQualityReport,
    reason: string,
  ): void {
    const dir = this.config.outputDir;
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const filePath = resolve(dir, `proposal-for-${issue.number}.rejected.md`);
    const duplicate = quality.duplicateMatch
      ? `- Duplicate match: @${quality.duplicateMatch.author} (${Math.round(quality.duplicateMatch.similarity * 100)}%) ${quality.duplicateMatch.commentUrl ?? ''}`
      : '- Duplicate match: none';
    const audit = [
      '# Proposal Rejected by Hunter Quality Gate',
      '',
      `- Reason: ${reason}`,
      `- Missing paths: ${quality.missingPaths.join(', ') || 'none'}`,
      `- Invalid line references: ${quality.invalidLineReferences.join(', ') || 'none'}`,
      `- Missing claimed symbols: ${quality.missingClaimedSymbols.join(', ') || 'none'}`,
      duplicate.replace('Duplicate match', 'Closest competitor overlap'),
      '',
      '## Candidate',
      '',
      body,
    ].join('\n');
    writeFileSync(filePath, audit, 'utf-8');
    console.log(`   Proposal quarantined: ${filePath}`);
  }
}
