import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { Config } from './config.js';
import type { ToolDefinition, ToolResult } from './types.js';

// ─── Tool Definition Factories ───────────────────────────────────────────

export function makeToolDefinitions(): ToolDefinition[] {
  return [
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read a file from the Expensify codebase. Use this to examine source code, components, hooks, etc.',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Relative path from Expensify/App root (e.g. src/components/VideoPlayer/BaseVideoPlayer.tsx)',
            },
            startLine: {
              type: 'number',
              description: 'Optional starting line number (1-indexed). Use this to read specific sections of large files.',
            },
            maxLines: {
              type: 'number',
              description: 'Maximum lines to read (default: 200). Use 999999 for small files.',
              default: 200,
            },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'grep_search',
        description: 'Search for a string or pattern across the Expensify codebase. Use this to find where functions are defined, where translation keys are used, etc.',
        parameters: {
          type: 'object',
          properties: {
            pattern: {
              type: 'string',
              description: 'The search pattern (plain text or regex). Case-insensitive.',
            },
            includePattern: {
              type: 'string',
              description: 'Optional glob to narrow search scope (e.g. src/pages/** or src/libs/**/*.ts)',
            },
            maxResults: {
              type: 'number',
              description: 'Maximum results to return (default: 20)',
              default: 20,
            },
          },
          required: ['pattern'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_directory',
        description: 'List files and subdirectories in a directory path. Use this to explore the codebase structure.',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Relative path from Expensify/App root (e.g. src/components/VideoPlayer)',
            },
            maxDepth: {
              type: 'number',
              description: 'How deep to recurse (0 = just this dir, 1 = one level deep, default: 0)',
              default: 0,
            },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_contributing_guide',
        description: 'Read the Expensify contributing guide or any file from contributingGuides/ directory.',
        parameters: {
          type: 'object',
          properties: {
            guideName: {
              type: 'string',
              description: 'Guide filename (e.g. CONTRIBUTING.md, STYLE.md, TESTING.md). Default: CONTRIBUTING.md',
              default: 'CONTRIBUTING.md',
            },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'find_symbol',
        description: 'Find symbol definitions (functions, classes, constants, interfaces) across the codebase. Uses grep for intelligent symbol discovery.',
        parameters: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'The symbol name to find (function name, constant name, component name, etc.)',
            },
            kind: {
              type: 'string',
              enum: ['function', 'const', 'class', 'interface', 'type', 'component'],
              description: 'Optional kind hint to narrow results',
            },
          },
          required: ['name'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'extract_info',
        description: 'Read the issue body and extract structured information: Action Performed, Expected Result, Actual Result, and relevant files mentioned.',
        parameters: {
          type: 'object',
          properties: {
            issueBody: {
              type: 'string',
              description: 'The full body of the GitHub issue',
            },
          },
          required: ['issueBody'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'done',
        description: 'Call this ONLY when you have completed the full investigation and have a complete proposal ready. Your final message must be the COMPLETE proposal markdown following the exact Expensify template.',
        parameters: {
          type: 'object',
          properties: {
            proposal: {
              type: 'string',
              description: 'The COMPLETE proposal in Expensify format. Must include all sections: problem statement, root cause (with file paths), proposed changes (with exact code), and alternative solutions.',
            },
            confidence: {
              type: 'string',
              enum: ['high', 'medium', 'low'],
              description: 'Confidence in your proposal',
            },
          },
          required: ['proposal', 'confidence'],
        },
      },
    },
  ];
}

// ─── Tool Execution Engine ───────────────────────────────────────────────

export class ToolExecutor {
  constructor(private config: Config) {}

  /** Maximum characters of output to return per tool call */
  private readonly MAX_OUTPUT = 15000;

  async execute(name: string, args: Record<string, unknown>, toolCallId: string): Promise<ToolResult> {
    try {
      const content = await this.dispatch(name, args);
      return {
        role: 'tool',
        tool_call_id: toolCallId,
        content: content.slice(0, this.MAX_OUTPUT),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        role: 'tool',
        tool_call_id: toolCallId,
        content: `ERROR: ${msg}`,
      };
    }
  }

  private async dispatch(name: string, args: Record<string, unknown>): Promise<string> {
    switch (name) {
      case 'read_file':
      if (!args.path) return `ERROR: 'path' argument is required for read_file. Example: read_file({path: "src/components/SomeFile.tsx"})`;
      return this.readFile(String(args.path), Number(args.maxLines ?? 200), args.startLine ? Number(args.startLine) : undefined);
      case 'grep_search': return this.grepSearch(
        String(args.pattern),
        args.includePattern ? String(args.includePattern) : undefined,
        Number(args.maxResults ?? 20),
      );
      case 'list_directory': return this.listDir(String(args.path), Number(args.maxDepth ?? 0));
      case 'read_contributing_guide': return this.readGuide(String(args.guideName ?? 'CONTRIBUTING.md'));
      case 'find_symbol': return this.findSymbol(String(args.name), String(args.kind ?? ''));
      case 'extract_info': return this.extractInfo(String(args.issueBody));
      case 'done': return 'PROPOSAL_COMPLETE'; // handled by caller
      default: throw new Error(`Unknown tool: ${name}`);
    }
  }

  private rootPath(subPath: string): string {
    const full = resolve(this.config.expensifyPath, subPath);
    if (!full.startsWith(resolve(this.config.expensifyPath))) {
      throw new Error('Path traversal detected');
    }
    return full;
  }

  private async readFile(relativePath: string, maxLines: number, startLine?: number): Promise<string> {
    const full = this.rootPath(relativePath);
    if (!existsSync(full)) throw new Error(`File not found: ${relativePath}`);
    const content = readFileSync(full, 'utf-8');
    const allLines = content.split('\n');
    const sliceStart = startLine ? Math.max(0, startLine - 1) : 0;
    const slice = allLines.slice(sliceStart, sliceStart + maxLines);
    const suffix = allLines.length > sliceStart + maxLines ? `\n\n... [${allLines.length - (sliceStart + maxLines)} more lines truncated]` : '';
    const header = startLine ? `--- ${relativePath} (lines ${startLine}-${sliceStart + slice.length}) ---` : `--- ${relativePath} (${allLines.length} lines) ---`;
    return `${header}\n${slice.join('\n')}${suffix}`;
  }

  private async grepSearch(pattern: string, includePattern?: string, maxResults?: number): Promise<string> {
    const extMappings: Record<string, string[]> = {
      ts: ['.ts', '.tsx'],
      js: ['.js', '.jsx'],
    };

    const results: string[] = [];

    const searchDir = this.config.expensifyPath;
    // Use a simple grep-like approach: find files and search within
    const { execSync } = await import('node:child_process');

    const includeArg = includePattern ? `--include="${includePattern}"` : '';
    const grepCmd = [
      `grep -rn "${pattern.replace(/"/g, '\\"')}"`,
      includeArg,
      `--max-count=${Math.min(maxResults ?? 20, 100)}`,
      `--exclude-dir=node_modules`,
      `--exclude-dir=.git`,
      `--exclude-dir=android`,
      `--exclude-dir=ios`,
      `--exclude-dir=venv`,
      `--exclude-dir=dist`,
      `--exclude-dir=build`,
      `${this.config.expensifyPath}/src/`,
    ].filter(Boolean).join(' ');

    try {
      const output = execSync(grepCmd, { encoding: 'utf-8', maxBuffer: 2 * 1024 * 1024, timeout: 15000 });
      const lines = output.split('\n').filter(Boolean).slice(0, maxResults ?? 20);
      return `Found ${output.split('\n').filter(Boolean).length} matches (showing up to ${maxResults ?? 20}):\n\n${lines.join('\n')}`;
    } catch {
      return `No matches found for "${pattern}"`;
    }
  }

  private async listDir(relativePath: string, maxDepth: number): Promise<string> {
    const full = this.rootPath(relativePath);
    if (!existsSync(full)) throw new Error(`Directory not found: ${relativePath}`);
    if (!statSync(full).isDirectory()) return `[file] ${relativePath}`;

    const lines: string[] = [];
    const walk = (dir: string, depth: number) => {
      if (depth > maxDepth) return;
      const indent = '  '.repeat(depth);
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
          if (entry.isDirectory()) {
            const rel = dir === full ? entry.name : relativePath + '/' + entry.name;
            lines.push(indent + '[DIR] ' + entry.name + '/');
            if (depth < maxDepth) walk(resolve(dir, entry.name), depth + 1);
          } else {
            lines.push(indent + '[FILE] ' + entry.name);
          }
        }
      } catch { /* skip inaccessible */ }
    };

    lines.push('[DIR] ' + relativePath + '/');
    walk(full, 1);
    return lines.join('\n');
  }

  private async readGuide(guideName: string): Promise<string> {
    const candidatePaths = [
      `contributingGuides/${guideName}`,
      `.github/contributingGuides/${guideName}`,
      `contributingGuides/${guideName.replace(/\.md$/, '')}.md`,
    ];
    for (const rel of candidatePaths) {
      const full = resolve(this.config.expensifyPath, rel);
      if (existsSync(full)) {
        const content = readFileSync(full, 'utf-8');
        return `--- ${rel} ---\n${content.slice(0, 10000)}`;
      }
    }
    return `Contributing guide "${guideName}" not found.`;
  }

  private async findSymbol(name: string, kind: string): Promise<string> {
    // Search for definitions — function/const/class declarations
    const patterns: string[] = [
      `(export\\s+)?(function|const|class|interface|type)\\s+${name}\\b`,
      `\\b${name}\\s*[=:(]\\s*`,
      `import\\s+.*\\b${name}\\b`,
    ];

    const results: string[] = [];
    for (const p of patterns) {
      try {
        const { execSync } = await import('node:child_process');
        const grepCmd = [
          `grep -rn "${p.replace(/"/g, '\\"')}"`,
          `--max-count=10`,
          `--exclude-dir=node_modules`,
          `--exclude-dir=.git`,
          `${this.config.expensifyPath}/src/`,
        ].join(' ');

        const output = execSync(grepCmd, { encoding: 'utf-8', maxBuffer: 1024 * 1024, timeout: 10000 });
        const lines = output.split('\n').filter(Boolean).slice(0, 10);
        if (lines.length > 0) {
          results.push(`Pattern "${p}":\n${lines.join('\n')}`);
          break; // Found it, no need for more patterns
        }
      } catch { /* continue */ }
    }

    if (results.length === 0) {
      // Fallback: try non-regex grep
      try {
        const { execSync } = await import('node:child_process');
        const grepCmd = [
          `grep -rn "${name.replace(/"/g, '\\"')}"`,
          `--max-count=15`,
          `--exclude-dir=node_modules`,
          `--exclude-dir=.git`,
          `${this.config.expensifyPath}/src/`,
        ].join(' ');
        const output = execSync(grepCmd, { encoding: 'utf-8', maxBuffer: 1024 * 1024, timeout: 10000 });
        const lines = output.split('\n').filter(Boolean).slice(0, 15);
        if (lines.length > 0) {
          return `Relevant matches for "${name}":\n${lines.join('\n')}`;
        }
      } catch { /* */ }
      return `Symbol "${name}" not found.`;
    }

    return results.join('\n\n');
  }

  private async extractInfo(issueBody: string): Promise<string> {
    // Clean and parse the issue body using a structured prompt
    // Actually, we return instructions to the LLM about what to look for
    return `Please analyze this issue body and extract:
1. **Action Performed**: What steps did the user take?
2. **Expected Result**: What should have happened?
3. **Actual Result**: What actually happened (the bug)?
4. **Relevant URLs/Routes**: Any specific URLs or routes mentioned
5. **Relevant Components**: Any component names or file paths hinted at
6. **Translation Keys**: Any UI strings that might be translation keys (e.g., common.action)

Issue body:
${issueBody.slice(0, 8000)}`;
  }
}