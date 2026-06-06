import {execFileSync} from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import {relative, resolve, sep} from 'node:path';
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
        name: 'find_files',
        description: 'Find files by glob across the repository using ripgrep file discovery.',
        parameters: {
          type: 'object',
          properties: {
            pattern: {
              type: 'string',
              description: 'Glob pattern such as **/*Split*.ts or src/**/MoneyRequest*.tsx.',
            },
            maxResults: {
              type: 'number',
              description: 'Maximum paths to return (default: 100).',
              default: 100,
            },
          },
          required: ['pattern'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'grep_search',
        description: 'Run a ripgrep regex search across the repository with file paths and line numbers.',
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
        name: 'git_history',
        description: 'Inspect commits that touched a file, optionally following renames.',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Repository-relative file path.',
            },
            maxResults: {
              type: 'number',
              description: 'Maximum commits to return (default: 10).',
              default: 10,
            },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'git_show_file',
        description: 'Read a repository file at a specific commit or branch, useful for code links in issue comments.',
        parameters: {
          type: 'object',
          properties: {
            revision: {
              type: 'string',
              description: 'Git revision or commit SHA.',
            },
            path: {
              type: 'string',
              description: 'Repository-relative file path.',
            },
            startLine: {
              type: 'number',
              description: 'Optional starting line number (1-indexed).',
            },
            maxLines: {
              type: 'number',
              description: 'Maximum lines to return (default: 200).',
              default: 200,
            },
          },
          required: ['revision', 'path'],
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
        name: 'finish_investigation',
        description: 'Finish only after tracing the failing user journey through source code and verifying competitor claims.',
        parameters: {
          type: 'object',
          properties: {
            report: {
              type: 'string',
              description: 'Evidence report with exact paths, line numbers, symbols, data flow, root cause, regression risks, and competitor differentiation.',
            },
            confidence: {
              type: 'string',
              enum: ['high', 'medium', 'low'],
              description: 'Confidence in the evidence report',
            },
          },
          required: ['report', 'confidence'],
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
      case 'find_files': return this.findFiles(String(args.pattern), Number(args.maxResults ?? 100));
      case 'grep_search': return this.grepSearch(
        String(args.pattern),
        args.includePattern ? String(args.includePattern) : undefined,
        Number(args.maxResults ?? 20),
      );
      case 'list_directory': return this.listDir(String(args.path), Number(args.maxDepth ?? 0));
      case 'git_history': return this.gitHistory(String(args.path), Number(args.maxResults ?? 10));
      case 'git_show_file': return this.gitShowFile(
        String(args.revision),
        String(args.path),
        Number(args.maxLines ?? 200),
        args.startLine ? Number(args.startLine) : undefined,
      );
      case 'read_contributing_guide': return this.readGuide(String(args.guideName ?? 'CONTRIBUTING.md'));
      case 'find_symbol': return this.findSymbol(String(args.name), String(args.kind ?? ''));
      case 'extract_info': return this.extractInfo(String(args.issueBody));
      case 'finish_investigation': return 'INVESTIGATION_COMPLETE'; // handled by caller
      default: throw new Error(`Unknown tool: ${name}`);
    }
  }

  private rootPath(subPath: string): string {
    const root = resolve(this.config.expensifyPath);
    const full = resolve(root, subPath);
    const relativePath = relative(root, full);
    if (relativePath === '..' || relativePath.startsWith(`..${sep}`)) {
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
    const limit = Math.min(maxResults ?? 20, 100);
    const args = ['--line-number', '--no-heading', '--color', 'never', '--smart-case'];
    if (includePattern) {
      args.push('--glob', includePattern);
    }
    args.push('--glob', '!node_modules/**', '--glob', '!.git/**', '--glob', '!dist/**', '--glob', '!build/**', pattern, '.');
    try {
      const output = execFileSync('rg', args, {
        cwd: this.config.expensifyPath,
        encoding: 'utf-8',
        maxBuffer: 2 * 1024 * 1024,
        timeout: 15000,
      });
      const allLines = output.split('\n').filter(Boolean);
      return `Found ${allLines.length} matches (showing up to ${limit}):\n\n${allLines.slice(0, limit).join('\n')}`;
    } catch {
      return `No matches found for "${pattern}"`;
    }
  }

  private async findFiles(pattern: string, maxResults: number): Promise<string> {
    try {
      const output = execFileSync('rg', ['--files', '--glob', pattern, '--glob', '!node_modules/**', '--glob', '!.git/**'], {
        cwd: this.config.expensifyPath,
        encoding: 'utf-8',
        maxBuffer: 2 * 1024 * 1024,
        timeout: 15000,
      });
      const paths = output.split('\n').filter(Boolean);
      return `Found ${paths.length} files (showing up to ${maxResults}):\n${paths.slice(0, maxResults).join('\n')}`;
    } catch {
      return `No files found for glob "${pattern}"`;
    }
  }

  private async listDir(relativePath: string, maxDepth: number): Promise<string> {
    const full = this.rootPath(relativePath);
    if (!existsSync(full)) throw new Error(`Directory not found: ${relativePath}`);
    if (!statSync(full).isDirectory()) return `[file] ${relativePath}`;

    const lines: string[] = [`[DIR] ${relativePath || '.'}/`];
    const walk = (dir: string, depth: number) => {
      if (depth > maxDepth) return;
      const indent = '  '.repeat(depth);
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
          if (entry.isDirectory()) {
            lines.push(indent + '[DIR] ' + entry.name + '/');
            if (depth < maxDepth) walk(resolve(dir, entry.name), depth + 1);
          } else {
            lines.push(indent + '[FILE] ' + entry.name);
          }
        }
      } catch { /* skip inaccessible */ }
    };

    walk(full, 0);
    return lines.join('\n');
  }

  private async gitHistory(relativePath: string, maxResults: number): Promise<string> {
    this.rootPath(relativePath);
    try {
      return execFileSync(
        'git',
        ['log', '--follow', `-n${Math.min(maxResults, 30)}`, '--date=short', '--pretty=format:%h | %ad | %an | %s', '--', relativePath],
        {
          cwd: this.config.expensifyPath,
          encoding: 'utf-8',
          maxBuffer: 1024 * 1024,
          timeout: 15000,
        },
      );
    } catch {
      return `No git history found for "${relativePath}"`;
    }
  }

  private async gitShowFile(revision: string, relativePath: string, maxLines: number, startLine?: number): Promise<string> {
    this.rootPath(relativePath);
    if (!/^[A-Za-z0-9_./~-]+$/.test(revision)) {
      throw new Error('Invalid git revision');
    }
    const content = execFileSync('git', ['show', `${revision}:${relativePath}`], {
      cwd: this.config.expensifyPath,
      encoding: 'utf-8',
      maxBuffer: 4 * 1024 * 1024,
      timeout: 15000,
    });
    const lines = content.split('\n');
    const sliceStart = startLine ? Math.max(0, startLine - 1) : 0;
    const slice = lines.slice(sliceStart, sliceStart + maxLines);
    return `--- ${revision}:${relativePath} (lines ${sliceStart + 1}-${sliceStart + slice.length}) ---\n${slice.join('\n')}`;
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
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {
      throw new Error('Invalid symbol name');
    }
    const declarationKinds = kind
      ? kind === 'component' ? '(?:function|const|class)' : kind
      : '(?:function|const|class|interface|type)';
    const declarationPattern = `(?:export\\s+)?${declarationKinds}\\s+${name}\\b|\\b${name}\\s*[:=]\\s*(?:\\(|function)`;
    const declarations = await this.grepSearch(declarationPattern, 'src/**/*.{ts,tsx,js,jsx}', 20);
    if (!declarations.startsWith('No matches')) {
      return declarations;
    }
    return this.grepSearch(`\\b${name}\\b`, 'src/**/*.{ts,tsx,js,jsx}', 30);
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
