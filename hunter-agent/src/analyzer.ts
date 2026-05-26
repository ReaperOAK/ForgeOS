import type { Config } from './config.js';
import { IssueFetcher } from './fetcher.js';
import { makeToolDefinitions, ToolExecutor } from './tools.js';
import type { GitHubIssue, GitHubComment, Proposal, ChatMessage, OpenRouterChunk } from './types.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export class Analyzer {
  private fetcher: IssueFetcher;
  private toolExecutor: ToolExecutor;
  private toolDefs = makeToolDefinitions();

  constructor(private config: Config) {
    this.fetcher = new IssueFetcher(config);
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
   * Deterministic 2-Phase Pipeline:
   *   Phase 1: Code-driven investigation (grep key terms from issue body, read relevant files)
   *   Phase 2: Feed all context to LLM (NO tools) to write proposal
   *
   * This is much more reliable than LLM-driven tool calling, which tends to loop.
   */
  private async analyze(issue: GitHubIssue, comments: GitHubComment[]): Promise<Proposal> {
    console.log(`\n🔍 Investigating Expensify/App issue #${issue.number}: "${issue.title}"`);

    // ── Phase 1: Code-driven investigation ─────────────────────────
    const contextNotes: string[] = [];

    // 1. Extract key terms from the issue body
    const issueBody = issue.body ?? '';
    const issueLines = issueBody.split('\n');
    const actionPerformed = issueLines.filter(l => /action|step|click|tap|navigate|open|select|enter/i.test(l)).join('\n').slice(0, 1000);
    const expectedResult = issueLines.filter(l => /expect|should|would|hoping|suppose/i.test(l)).join('\n').slice(0, 500);
    const actualResult = issueLines.filter(l => /actual|instead|but|issue|problem|bug|wrong|break|fail|error/i.test(l)).join('\n').slice(0, 500);

    contextNotes.push(`=== ISSUE PARSE ===`);
    contextNotes.push(`Action Performed: ${actionPerformed || '(not clearly stated)'}`);
    contextNotes.push(`Expected Result: ${expectedResult || '(not clearly stated)'}`);
    contextNotes.push(`Actual Result: ${actualResult || '(not clearly stated)'}`);

    // 2. Search for relevant file paths mentioned in the issue
    const issueKeywords = this.extractKeywords(issueBody);
    contextNotes.push(`\n=== KEYWORDS FROM ISSUE ===`);
    contextNotes.push(issueKeywords.join(', '));

    // 3. Search for key components/hooks mentioned
    for (const keyword of issueKeywords.slice(0, 5)) {
      try {
        const result = await this.toolExecutor.execute('grep_search', { pattern: keyword, maxResults: 10 }, `search-${keyword}`);
        if (result.content && !result.content.startsWith('No matches')) {
          contextNotes.push(`\n=== SEARCH: "${keyword}" ===`);
          contextNotes.push(result.content.slice(0, 1000));
        }
      } catch { /* skip */ }
    }

    // 4. Read key files found
    const filesToRead = this.extractFilePaths(contextNotes.join('\n'));
    for (const filePath of filesToRead.slice(0, 4)) {
      try {
        const result = await this.toolExecutor.execute('read_file', { path: filePath, maxLines: 300 }, `read-${filePath}`);
        if (result.content && !result.content.startsWith('ERROR')) {
          contextNotes.push(`\n=== FILE: ${filePath} ===`);
          contextNotes.push(result.content.slice(0, 2000));
        }
      } catch { /* skip */ }
    }

    // 5. Add competitor analysis from comments
    const competitorComments = comments
      .filter(c => c.body && (c.body.includes('# Proposal') || c.body.includes('### Proposal') || c.body.includes('## Proposal')))
      .slice(0, 3);

    if (competitorComments.length > 0) {
      contextNotes.push(`\n=== COMPETITOR PROPOSALS ===`);
      for (const c of competitorComments) {
        contextNotes.push(`--- ${c.user.login} ---\n${c.body.slice(0, 1500)}`);
      }
    }

    const fullContext = contextNotes.join('\n\n');

    // ── Phase 2: LLM writes proposal (NO tools available) ───────────
    console.log(`\n📝 Generating proposal from ${contextNotes.length} context items...`);

    const proposalMessages: ChatMessage[] = [
      {
        role: 'system',
        content: `You are an elite React Native architect competing for Expensify bug bounties. Write a competition-killer proposal based on the investigation context below.

Format your response EXACTLY as:

# Proposal

### Please re-state the problem that we are trying to solve in this issue.
...

### What is the root cause of that problem?
(Include exact file paths, function names, and why it fails)

### What changes do you think we should make in order to solve the problem?
(Include exact file paths and surgical code changes. Show pseudo-diff or exact code.)

### What alternative solutions did you explore? (Optional)
(Your competitive edge — out-architect others by noting flaws in their approach)`,
      },
      {
        role: 'user',
        content: `Here is the investigation context for issue #${issue.number} ("${issue.title}"):

${fullContext}

Issue URL: ${issue.html_url}

Write the complete proposal now. Be surgical and specific. Include exact file paths and code changes.`,
      },
    ];

    const response = await this.callLLM(proposalMessages, false);
    const proposalText = this.extractText(response);

    if (!proposalText || proposalText.length < 50) {
      return this.saveProposal(issue, `Failed to generate proposal. Raw response: ${JSON.stringify(response).slice(0, 1000)}`, 0);
    }

    return this.saveProposal(issue, proposalText, 0);
  }

  /** Extract keywords from issue body for codebase search */
  private extractKeywords(body: string): string[] {
    const keywords: string[] = [];
    // Common Expensify patterns
    const patterns = [
      /use[A-Z][a-zA-Z]+/g,          // hooks: useNewTransactions
      /[A-Z][a-z]+[A-Z][a-zA-Z]+/g,   // Components: MoneyRequestReportPreview
      /\b(CONST\.[A-Z_.]+)/g,         // CONST values
      /\b(ONYXKEYS?\.[A-Z_]+)/g,      // Onyx keys
      /\b[src]+\/[a-zA-Z\/.]+/g,       // file paths
    ];
    for (const p of patterns) {
      const matches = body.match(p);
      if (matches) keywords.push(...matches);
    }
    // Also grab any quoted strings that look like file paths
    const quotedPaths = body.match(/['"]([a-zA-Z\/]+\.(ts|tsx|js|jsx))['"]/g);
    if (quotedPaths) keywords.push(...quotedPaths.map(s => s.replace(/['"]/g, '')));

    return [...new Set(keywords)].slice(0, 15);
  }

  /** Extract file paths from context text */
  private extractFilePaths(text: string): string[] {
    const paths: string[] = [];
    const matches = text.matchAll(/[a-zA-Z0-9_\/-]+\.(ts|tsx|js|jsx)/g);
    for (const m of matches) {
      const p = m[0].replace(/^\/+/, '');
      if (!p.startsWith('node_modules') && !p.startsWith('.')) {
        paths.push(p);
      }
    }
    return [...new Set(paths)];
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
      })),
      stream: true,
    };

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
}