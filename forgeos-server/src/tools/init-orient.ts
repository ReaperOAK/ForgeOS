/**
 * init.orient — Project orientation MCP tool.
 *
 * Auto-discovers project framework, build system, package manager,
 * test frameworks, languages, entry points, and key directories.
 * Generates a structured orientation summary that agents use for
 * first-contact with a new codebase.
 *
 * @module tools/init-orient
 * @ticket TASK-INT-BE043
 */

import { z } from 'zod';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { logger } from '../middleware/logging.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// ── Zod Input Schema ─────────────────────────────────────────────────────────

/**
 * Zod input schema for the `init.orient` MCP tool.
 *
 * - `root_path` (required) — Absolute path to the workspace root to orient.
 */
export const initOrientSchema = z.object({
    root_path: z.string().min(1).describe(
        'Absolute path to the workspace root directory to orient',
    ),
});

/** Validated input type derived from the Zod schema. */
type InitOrientInput = z.infer<typeof initOrientSchema>;

// ── Response Types ───────────────────────────────────────────────────────────

/** Orientation summary returned from the tool. */
export interface OrientationResult {
    project_name: string;
    package_manager: string | null;
    frameworks: string[];
    languages: string[];
    entry_points: string[];
    test_framework: string | null;
    build_system: string | null;
    key_directories: string[];
    config_files: string[];
}

// ── Lock-file → Package Manager Mapping ──────────────────────────────────────

const LOCK_FILE_MAP: ReadonlyArray<[string, string]> = [
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm'],
  ['Pipfile.lock', 'pipenv'],
  ['poetry.lock', 'poetry'],
  ['requirements.txt', 'pip'],
  ['Cargo.lock', 'cargo'],
  ['go.sum', 'go modules'],
];

// ── Framework Detection Maps ─────────────────────────────────────────────────

/** NPM dependency name → framework label. */
const NPM_FRAMEWORK_MAP: ReadonlyMap<string, string> = new Map([
  ['next', 'Next.js'],
  ['react', 'React'],
  ['vue', 'Vue'],
  ['@angular/core', 'Angular'],
  ['svelte', 'Svelte'],
  ['express', 'Express'],
  ['fastify', 'Fastify'],
  ['koa', 'Koa'],
  ['hapi', 'Hapi'],
  ['nestjs', 'NestJS'],
  ['@nestjs/core', 'NestJS'],
  ['nuxt', 'Nuxt'],
  ['gatsby', 'Gatsby'],
  ['remix', 'Remix'],
  ['@remix-run/react', 'Remix'],
  ['electron', 'Electron'],
]);

/** Python package patterns → framework label. */
const PYTHON_FRAMEWORK_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/\bdjango\b/i, 'Django'],
  [/\bfastapi\b/i, 'FastAPI'],
  [/\bflask\b/i, 'Flask'],
  [/\btornado\b/i, 'Tornado'],
  [/\bpyramid\b/i, 'Pyramid'],
  [/\bstarlette\b/i, 'Starlette'],
  [/\bsanic\b/i, 'Sanic'],
  [/\baiohttp\b/i, 'aiohttp'],
  [/\bcelery\b/i, 'Celery'],
];

// ── Test Framework Detection ─────────────────────────────────────────────────

/** NPM dependency name → test framework label. */
const NPM_TEST_FRAMEWORK_MAP: ReadonlyMap<string, string> = new Map([
  ['vitest', 'vitest'],
  ['jest', 'jest'],
  ['mocha', 'mocha'],
  ['ava', 'ava'],
  ['jasmine', 'jasmine'],
  ['cypress', 'cypress'],
  ['playwright', 'playwright'],
  ['@playwright/test', 'playwright'],
]);

/** Python package patterns → test framework label. */
const PYTHON_TEST_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/\bpytest\b/i, 'pytest'],
  [/\bunittest\b/i, 'unittest'],
  [/\bnose2?\b/i, 'nose'],
];

// ── Build System Detection ───────────────────────────────────────────────────

/** Build system detection by file presence. */
const BUILD_SYSTEM_FILES: ReadonlyArray<[string, string]> = [
  ['webpack.config.js', 'webpack'],
  ['webpack.config.ts', 'webpack'],
  ['vite.config.ts', 'vite'],
  ['vite.config.js', 'vite'],
  ['rollup.config.js', 'rollup'],
  ['rollup.config.ts', 'rollup'],
  ['esbuild.config.js', 'esbuild'],
  ['turbo.json', 'turborepo'],
  ['nx.json', 'nx'],
  ['Makefile', 'make'],
  ['CMakeLists.txt', 'cmake'],
  ['Cargo.toml', 'cargo'],
  ['build.gradle', 'gradle'],
  ['pom.xml', 'maven'],
];

// ── Config File Detection ────────────────────────────────────────────────────

const CONFIG_FILE_NAMES: ReadonlyArray<string> = [
  'tsconfig.json',
  'jsconfig.json',
  '.eslintrc.json',
  '.eslintrc.js',
  'eslint.config.js',
  'eslint.config.mjs',
  '.prettierrc',
  '.prettierrc.json',
  'prettier.config.js',
  'jest.config.ts',
  'jest.config.js',
  'vitest.config.ts',
  'vitest.config.js',
  'tailwind.config.ts',
  'tailwind.config.js',
  'postcss.config.js',
  'docker-compose.yml',
  'docker-compose.yaml',
  'Dockerfile',
  '.env',
  '.env.local',
  '.env.example',
  'pyproject.toml',
  'setup.py',
  'setup.cfg',
  'tox.ini',
  'mypy.ini',
  '.flake8',
];

// ── Key Directory Detection ──────────────────────────────────────────────────

const KEY_DIRECTORY_NAMES: ReadonlyArray<string> = [
  'src',
  'lib',
  'app',
  'pages',
  'components',
  'api',
  'routes',
  'controllers',
  'services',
  'models',
  'middleware',
  'utils',
  'helpers',
  'config',
  'db',
  'database',
  'migrations',
  'tests',
  'test',
  '__tests__',
  'specs',
  'scripts',
  'docs',
  'public',
  'static',
  'assets',
  'dist',
  'build',
];

// ── Entry Point Detection ────────────────────────────────────────────────────

const ENTRY_POINT_FILES: ReadonlyArray<string> = [
  'index.ts',
  'index.js',
  'main.ts',
  'main.js',
  'server.ts',
  'server.js',
  'app.ts',
  'app.js',
  'app.py',
  'main.py',
  'manage.py',
  'wsgi.py',
  'asgi.py',
  'src/index.ts',
  'src/index.js',
  'src/main.ts',
  'src/main.js',
  'src/server.ts',
  'src/server.js',
  'src/app.ts',
  'src/app.js',
];

// ── Detection Functions ──────────────────────────────────────────────────────

/**
 * Check if a file exists at rootPath/fileName.
 */
function fileExists(rootPath: string, fileName: string): boolean {
  try {
    return fs.existsSync(path.join(rootPath, fileName));
  } catch {
    return false;
  }
}

/**
 * Safely read a file as UTF-8 text, returning null on failure.
 */
function safeReadFile(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Safely JSON-parse a string, returning null on failure.
 */
function safeJsonParse(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Read and parse a package.json if it exists, returning null on failure.
 */
function readPackageJson(rootPath: string): Record<string, unknown> | null {
  const content = safeReadFile(path.join(rootPath, 'package.json'));
  if (!content) return null;
  return safeJsonParse(content);
}

/**
 * Detect package manager by checking for lock files.
 */
export function detectPackageManager(rootPath: string): string | null {
  for (const [lockFile, manager] of LOCK_FILE_MAP) {
    if (fileExists(rootPath, lockFile)) return manager;
  }
  if (fileExists(rootPath, 'package.json')) return 'npm';
  return null;
}

/**
 * Detect frameworks from package.json dependencies and Python requirement files.
 */
export function detectFrameworks(rootPath: string): string[] {
  const frameworks: Set<string> = new Set();

  // Check package.json dependencies
  const pkg = readPackageJson(rootPath);
  if (pkg) {
    const allDeps: Record<string, unknown> = {
      ...(typeof pkg.dependencies === 'object' && pkg.dependencies !== null
        ? (pkg.dependencies as Record<string, unknown>)
        : {}),
      ...(typeof pkg.devDependencies === 'object' && pkg.devDependencies !== null
        ? (pkg.devDependencies as Record<string, unknown>)
        : {}),
    };

    for (const depName of Object.keys(allDeps)) {
      const framework = NPM_FRAMEWORK_MAP.get(depName);
      if (framework) frameworks.add(framework);
    }
  }

  // Check Python requirements files
  for (const reqFile of ['requirements.txt', 'Pipfile', 'pyproject.toml']) {
    const content = safeReadFile(path.join(rootPath, reqFile));
    if (content) {
      for (const [pattern, framework] of PYTHON_FRAMEWORK_PATTERNS) {
        if (pattern.test(content)) frameworks.add(framework);
      }
    }
  }

  return [...frameworks].sort();
}

/**
 * Detect primary languages used in the project.
 */
export function detectLanguages(rootPath: string): string[] {
  const languages: Set<string> = new Set();

  if (fileExists(rootPath, 'tsconfig.json') || fileExists(rootPath, 'tsconfig.build.json')) {
    languages.add('TypeScript');
  }
  if (fileExists(rootPath, 'package.json') || fileExists(rootPath, 'jsconfig.json')) {
    languages.add('JavaScript');
  }
  for (const pyFile of ['requirements.txt', 'Pipfile', 'pyproject.toml', 'setup.py', 'manage.py', 'app.py']) {
    if (fileExists(rootPath, pyFile)) {
      languages.add('Python');
      break;
    }
  }
  if (fileExists(rootPath, 'Cargo.toml')) languages.add('Rust');
  if (fileExists(rootPath, 'go.mod')) languages.add('Go');
  if (fileExists(rootPath, 'build.gradle') || fileExists(rootPath, 'pom.xml')) languages.add('Java');

  return [...languages].sort();
}

/**
 * Detect entry points from package.json "main" field and common file names.
 */
export function detectEntryPoints(rootPath: string): string[] {
  const entryPoints: string[] = [];

  // Check package.json main / module / bin
  const pkg = readPackageJson(rootPath);
  if (pkg) {
    for (const field of ['main', 'module']) {
      const value = pkg[field];
      if (typeof value === 'string' && value.length > 0) {
        entryPoints.push(value);
      }
    }
    // bin can be string or object
    if (typeof pkg.bin === 'string') {
      entryPoints.push(pkg.bin);
    } else if (typeof pkg.bin === 'object' && pkg.bin !== null) {
      for (const v of Object.values(pkg.bin as Record<string, string>)) {
        if (typeof v === 'string') entryPoints.push(v);
      }
    }
  }

  // Check common entry point files
  for (const ep of ENTRY_POINT_FILES) {
    if (fileExists(rootPath, ep) && !entryPoints.includes(ep)) {
      entryPoints.push(ep);
    }
  }

  return entryPoints;
}

/**
 * Detect test framework from dependencies or config files.
 */
export function detectTestFramework(rootPath: string): string | null {
  // Check package.json
  const pkg = readPackageJson(rootPath);
  if (pkg) {
    const allDeps: Record<string, unknown> = {
      ...(typeof pkg.dependencies === 'object' && pkg.dependencies !== null
        ? (pkg.dependencies as Record<string, unknown>)
        : {}),
      ...(typeof pkg.devDependencies === 'object' && pkg.devDependencies !== null
        ? (pkg.devDependencies as Record<string, unknown>)
        : {}),
    };

    for (const depName of Object.keys(allDeps)) {
      const testFw = NPM_TEST_FRAMEWORK_MAP.get(depName);
      if (testFw) return testFw;
    }
  }

  // Check config files for test frameworks
  for (const [configFile, fw] of [
    ['vitest.config.ts', 'vitest'],
    ['vitest.config.js', 'vitest'],
    ['jest.config.ts', 'jest'],
    ['jest.config.js', 'jest'],
    ['jest.config.json', 'jest'],
    ['.mocharc.yml', 'mocha'],
    ['.mocharc.json', 'mocha'],
    ['pytest.ini', 'pytest'],
    ['conftest.py', 'pytest'],
    ['tox.ini', 'pytest'],
    ['setup.cfg', 'pytest'],
  ] as const) {
    if (fileExists(rootPath, configFile)) return fw;
  }

  // Check Python requirements
  for (const reqFile of ['requirements.txt', 'Pipfile', 'pyproject.toml']) {
    const content = safeReadFile(path.join(rootPath, reqFile));
    if (content) {
      for (const [pattern, fw] of PYTHON_TEST_PATTERNS) {
        if (pattern.test(content)) return fw;
      }
    }
  }

  return null;
}

/**
 * Detect build system from config file presence.
 */
export function detectBuildSystem(rootPath: string): string | null {
  // Check package.json scripts for build hints
  const pkg = readPackageJson(rootPath);
  if (pkg) {
    const scripts = pkg.scripts;
    if (typeof scripts === 'object' && scripts !== null) {
      const buildScript = (scripts as Record<string, string>).build;
      if (typeof buildScript === 'string') {
        if (buildScript.includes('next')) return 'next';
        if (buildScript.includes('vite')) return 'vite';
        if (buildScript.includes('webpack')) return 'webpack';
        if (buildScript.includes('rollup')) return 'rollup';
        if (buildScript.includes('esbuild')) return 'esbuild';
        if (buildScript.includes('tsc')) return 'tsc';
        if (buildScript.includes('turbo')) return 'turborepo';
      }
    }
  }

  for (const [file, system] of BUILD_SYSTEM_FILES) {
    if (fileExists(rootPath, file)) return system;
  }

  return null;
}

/**
 * Find key directories that exist under the root path.
 */
export function detectKeyDirectories(rootPath: string): string[] {
  const dirs: string[] = [];
  for (const dir of KEY_DIRECTORY_NAMES) {
    try {
      const fullPath = path.join(rootPath, dir);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) dirs.push(dir);
    } catch {
      // Directory doesn't exist
    }
  }
  return dirs;
}

/**
 * Find config files that exist under the root path.
 */
export function detectConfigFiles(rootPath: string): string[] {
  const files: string[] = [];
  for (const file of CONFIG_FILE_NAMES) {
    if (fileExists(rootPath, file)) files.push(file);
  }
  return files;
}

/**
 * Derive project name from package.json "name" or the root directory basename.
 */
function detectProjectName(rootPath: string): string {
  const pkg = readPackageJson(rootPath);
  if (pkg && typeof pkg.name === 'string' && pkg.name.length > 0) {
    return pkg.name;
  }
  return path.basename(rootPath);
}

// ── Handler ──────────────────────────────────────────────────────────────────

/**
 * Auto-discover project framework, build system, and key entry points.
 *
 * Generates a structured orientation summary that agents use for
 * first-contact with a new codebase.
 *
 * @param input - Validated input with root_path
 * @returns MCP content response with orientation summary or error
 */
export async function initOrientHandler(
  input: InitOrientInput,
): Promise<CallToolResult> {
  const { root_path } = input;

  logger.info({ root_path }, 'init.orient called');

  try {
    // Validate root_path exists and is a directory
    const stat = fs.statSync(root_path);
    if (!stat.isDirectory()) {
      logger.warn({ root_path }, 'init.orient: root_path is not a directory');
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              error: 'root_path is not a directory',
              root_path,
              timestamp: new Date().toISOString(),
            }),
          },
        ],
        isError: true,
      };
    }

    const startMs = Date.now();

    const result: OrientationResult = {
      project_name: detectProjectName(root_path),
      package_manager: detectPackageManager(root_path),
      frameworks: detectFrameworks(root_path),
      languages: detectLanguages(root_path),
      entry_points: detectEntryPoints(root_path),
      test_framework: detectTestFramework(root_path),
      build_system: detectBuildSystem(root_path),
      key_directories: detectKeyDirectories(root_path),
      config_files: detectConfigFiles(root_path),
    };

    const durationMs = Date.now() - startMs;

    logger.info(
      {
        event: 'init_orient_complete',
        root_path,
        project_name: result.project_name,
        package_manager: result.package_manager,
        frameworks_count: result.frameworks.length,
        languages_count: result.languages.length,
        entry_points_count: result.entry_points.length,
        test_framework: result.test_framework,
        build_system: result.build_system,
        durationMs,
      },
      'init.orient completed',
    );

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(result),
        },
      ],
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    logger.error(
      { root_path, error: message },
      'init.orient failed',
    );

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            error: 'Orientation failed',
            message,
            root_path,
            timestamp: new Date().toISOString(),
          }),
        },
      ],
      isError: true,
    };
  }
}
