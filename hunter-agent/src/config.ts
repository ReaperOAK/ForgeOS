import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface Config {
  /** OpenRouter API key */
  openrouterApiKey: string;
  /** LLM model to use (default: DeepSeek V4 Flash) */
  model: string;
  /** Path to the Expensify/App checkout */
  expensifyPath: string;
  /** GitHub token for API access */
  githubToken: string;
  /** Discord webhook for notifications */
  discordWebhook: string;
  /** Poll interval in seconds (when in watch mode) */
  pollInterval: number;
  /** Output directory for proposals */
  outputDir: string;
  /** Max tool call iterations per analysis */
  maxToolIterations: number;
}

function loadEnvFile(): Record<string, string> {
  const envPaths = [
    resolve(__dirname, '..', '.env'),
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '.env.hunter'),
  ];

  for (const p of envPaths) {
    if (existsSync(p)) {
      const content = readFileSync(p, 'utf-8');
      const vars: Record<string, string> = {};
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        vars[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      }
      return vars;
    }
  }
  return {};
}

export function loadConfig(): Config {
  const env = loadEnvFile();

  const get = (key: string, fallback?: string): string => {
    return process.env[key] ?? env[key] ?? fallback ?? '';
  };

  const openrouterApiKey = get('OPENROUTER_API_KEY');
  const githubToken = get('GITHUB_TOKEN');
  const discordWebhook = get('DISCORD_WEBHOOK');
  const expensifyPath = get('EXPENSIFY_PATH');

  if (!openrouterApiKey) throw new Error('OPENROUTER_API_KEY is required (set in .env or env)');
  if (!githubToken) throw new Error('GITHUB_TOKEN is required (set in .env or env)');
  if (!expensifyPath) throw new Error('EXPENSIFY_PATH is required — path to your Expensify/App checkout');

  return {
    openrouterApiKey,
    model: get('MODEL', 'deepseek/deepseek-v4-flash'),
    expensifyPath,
    githubToken,
    discordWebhook,
    pollInterval: parseInt(get('POLL_INTERVAL', '60'), 10),
    outputDir: get('OUTPUT_DIR', resolve(process.cwd(), 'agent-output', 'hunter')),
    maxToolIterations: parseInt(get('MAX_TOOL_ITERATIONS', '15'), 10),
  };
}