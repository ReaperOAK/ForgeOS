#!/usr/bin/env node

import { loadConfig } from './config.js';
import { IssueFetcher } from './fetcher.js';
import { Analyzer } from './analyzer.js';
import { submitProposal, findProposalFile } from './submitter.js';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function printHeader() {
  console.log(`
╔══════════════════════════════════════════╗
║     🎯  HUNTER AGENT  —  Bounty Sniper  ║
║     ForgeOS Autonomous Expensify Hunter  ║
╚══════════════════════════════════════════╝
  `);
}

function printHelp() {
  console.log(`
Usage:
  tsx src/index.ts --once              Analyze latest Help Wanted issue & exit
  tsx src/index.ts --issue 12345       Analyze a specific issue number
  tsx src/index.ts --submit [12345]    Submit proposal as issue comment (default: latest)
  tsx src/index.ts --auto [12345]      Analyze + submit in one shot (default: latest)
  tsx src/index.ts --watch             Watch mode: poll + auto-analyze
  tsx src/index.ts --watch-submit      Watch mode: poll + auto-analyze + auto-submit
  tsx src/index.ts --setup             Create .env.hunter template

Options:
  --once          One-shot analysis
  --issue <n>     Analyze a specific issue
  --submit [n]    Submit existing proposal as comment via gh CLI
  --auto [n]      Full pipeline: analyze + submit
  --watch         Continuous polling mode (analyze only)
  --watch-submit  Continuous polling mode (analyze + submit)
  --setup         Generate .env.hunter template
  --help          Show this help
`);
}

function setupEnv() {
  const template = `# ─── Hunter Agent Configuration ───────────────────────────────
# Copy this to .env and fill in your values

# Required: OpenRouter API key (get from https://openrouter.ai/keys)
OPENROUTER_API_KEY=sk-or-v1-your-key-here

# Required: GitHub token with public_repo scope
GITHUB_TOKEN=ghp_your_token_here

# Required: Absolute path to your local Expensify/App checkout
EXPENSIFY_PATH=/path/to/Expensify/App

# Branch Hunter must verify and fast-forward before analysis
EXPENSIFY_BRANCH=main

# Discord webhook URL (optional — sends notifications)
DISCORD_WEBHOOK=

# Poll interval in seconds (default: 60)
POLL_INTERVAL=60

# LLM model (default: anthropic/claude-sonnet-4.6)
MODEL=anthropic/claude-sonnet-4.6

# Max tool call iterations before forcing completion (default: 30)
MAX_TOOL_ITERATIONS=30

# Maximum completion tokens per OpenRouter call (default: 1024)
OPENROUTER_MAX_TOKENS=9999999

# Output directory for proposals (default: agent-output/hunter)
OUTPUT_DIR=agent-output/hunter
`;

  const envPath = resolve(process.cwd(), '.env.hunter');
  writeFileSync(envPath, template, 'utf-8');
  console.log(`✅ Created .env.hunter template at ${envPath}`);
  console.log('   Fill in your keys, then run: tsx src/index.ts --once');
}

async function watchMode(autoSubmit: boolean = false) {
  const config = loadConfig();
  const fetcher = new IssueFetcher(config);
  const analyzer = new Analyzer(config);

  console.log(`\n👀 Watch mode active — polling every ${config.pollInterval}s`);
  if (autoSubmit) console.log(`   Auto-submit: ON — proposals will be posted as comments`);
  console.log(`   Press Ctrl+C to stop\n`);

  let lastIssueId: number | null = null;

  // Baseline
  try {
    const latest = await fetcher.fetchLatest();
    if (latest) {
      lastIssueId = latest.id;
      console.log(`   Baseline set: #${latest.number} — "${latest.title}" (ID: ${latest.id})`);
    }
  } catch (err) {
    console.log(`   Initial fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    await new Promise(resolve => setTimeout(resolve, config.pollInterval * 1000));

    try {
      const latest = await fetcher.fetchLatest();
      if (!latest) {
        console.log(`   [${new Date().toLocaleTimeString()}] No issues found.`);
        continue;
      }

      if (latest.id !== lastIssueId) {
        console.log(`\n🚨 NEW ISSUE DETECTED! #${latest.number}: "${latest.title}"`);
        lastIssueId = latest.id;

        // Check for existing proposal
        const proposalPath = resolve(config.outputDir, `proposal-for-${latest.number}.md`);
        if (existsSync(proposalPath)) {
          console.log(`   Proposal already exists — skipping.`);
          continue;
        }

        // Analyzer preflight verifies the branch and fast-forwards the checkout.
        const proposal = await analyzer.analyzeIssue(latest.number);
        if (proposal) {
          console.log(`\n✅ Proposal generated for #${latest.number}`);

          // Auto-submit if watch mode is using --watch-submit
          if (autoSubmit) {
            const submitResult = await submitProposal(proposal.issueNumber, proposal.filePath, config, proposal.issueUrl);
            if (submitResult.success) {
              console.log(`   ✅ Auto-submitted: ${submitResult.issueUrl}`);
            } else {
              console.log(`   ⚠️ Auto-submit failed: ${submitResult.error}`);
            }
          }

          // Send Discord notification if configured
          if (config.discordWebhook) {
            try {
              const discordBody = {
                content: `🎯 **Proposal Generated**\n**Issue:** #${proposal.issueNumber} — ${proposal.issueTitle}\n**File:** \`${proposal.filePath}\`\n**Tool Calls:** ${proposal.toolCalls}\n**Model:** ${proposal.model}`,
              };
              await fetch(config.discordWebhook, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(discordBody),
              });
              console.log('   ✅ Discord notification sent');
            } catch (e) {
              console.log('   ⚠️ Discord notification failed');
            }
          }

        }
      }
    } catch (err) {
      console.error(`   ❌ Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);

  printHeader();

  if (args.length === 0 || args.includes('--help')) {
    printHelp();
    return;
  }

  if (args.includes('--setup')) {
    setupEnv();
    return;
  }

  // Validate .env.hunter exists
  const envHunter = resolve(process.cwd(), '.env.hunter');
  const envLocal = resolve(process.cwd(), '.env');
  if (!existsSync(envHunter) && !existsSync(envLocal)) {
    console.log('⚠️  No .env.hunter or .env file found. Run --setup to create one.\n');
    const res = await ask('Create .env.hunter template now? (Y/n): ');
    if (res.toLowerCase() !== 'n') {
      setupEnv();
      return;
    }
  }

  if (args.includes('--once')) {
    const config = loadConfig();
    const analyzer = new Analyzer(config);
    const proposal = await analyzer.analyzeLatest();
    if (proposal) {
      console.log(`\n📄 Proposal saved: ${proposal.filePath}`);
      console.log(`\nTo submit this proposal manually:`);
      console.log(`   tsx src/index.ts --submit ${proposal.issueNumber}`);
    } else {
      console.log('No new issue to analyze.');
    }
    return;
  }

  // ── Submit ──────────────────────────────────────────────────────────
  const submitIdx = args.indexOf('--submit');
  if (submitIdx >= 0) {
    const config = loadConfig();
    const submitIssueNumber = submitIdx + 1 < args.length && /^\d+$/.test(args[submitIdx + 1])
      ? parseInt(args[submitIdx + 1], 10)
      : await resolveLatestIssue(config);
    if (!submitIssueNumber) { console.log('No issue to submit for.'); return; }

    const propFile = findProposalFile(config.outputDir, submitIssueNumber);
    if (!propFile) {
      console.log(`No proposal found for #${submitIssueNumber}. Run --auto ${submitIssueNumber} first.`);
      return;
    }

    const result = await submitProposal(submitIssueNumber, propFile, config);
    if (result.success) {
      console.log(`✅ Proposal submitted: ${result.issueUrl}`);
    } else {
      console.error(`❌ Submission failed: ${result.error}`);
    }
    return;
  }

  // ── Auto (analyze + submit) ─────────────────────────────────────────
  const autoIdx = args.indexOf('--auto');
  if (autoIdx >= 0) {
    const config = loadConfig();
    const analyzer = new Analyzer(config);
    const issueNumber = autoIdx + 1 < args.length && /^\d+$/.test(args[autoIdx + 1])
      ? parseInt(args[autoIdx + 1], 10)
      : null;

    const proposal = issueNumber
      ? await analyzer.analyzeIssue(issueNumber)
      : await analyzer.analyzeLatest();

    if (proposal) {
      console.log(`\n📄 Proposal saved: ${proposal.filePath}`);
      const result = await submitProposal(proposal.issueNumber, proposal.filePath, config, proposal.issueUrl);
      if (result.success) {
        console.log(`✅ Proposal analyzed and submitted: ${result.issueUrl}`);
      } else {
        console.error(`❌ Analysis succeeded but submission failed: ${result.error}`);
      }
    } else {
      console.log('No new issue to analyze.');
    }
    return;
  }

  const issueIdx = args.indexOf('--issue');
  if (issueIdx >= 0 && issueIdx + 1 < args.length) {
    const issueNumber = parseInt(args[issueIdx + 1], 10);
    if (isNaN(issueNumber)) {
      console.error('Invalid issue number');
      process.exit(1);
    }
    const config = loadConfig();
    const analyzer = new Analyzer(config);
    const proposal = await analyzer.analyzeIssue(issueNumber);
    if (proposal) {
      console.log(`\n📄 Proposal saved: ${proposal.filePath}`);
    }
    return;
  }

  if (args.includes('--watch-submit')) {
    await watchMode(true);
    return;
  }

  if (args.includes('--watch')) {
    await watchMode(false);
    return;
  }

  printHelp();
}

async function ask(question: string): Promise<string> {
  const rl = await import('node:readline/promises');
  const r = rl.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await r.question(question);
  r.close();
  return answer;
}

/** Fetch the latest issue number, or prompt user */
async function resolveLatestIssue(config: ReturnType<typeof loadConfig>): Promise<number | null> {
  const fetcher = new IssueFetcher(config);
  const issue = await fetcher.fetchLatest();
  if (issue) {
    console.log(`   Latest Help Wanted: #${issue.number} — "${issue.title}"`);
    return issue.number;
  }
  return null;
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
