/**
 * Unit tests for the `init.orient` MCP tool.
 *
 * Tests verify all acceptance criteria:
 * - Zod schema validates root_path (required, non-empty)
 * - Detects package manager by checking lock files
 * - Detects frameworks from package.json dependencies and Python requirements
 * - Identifies entry points (main field in package.json, common filenames)
 * - Detects test frameworks (vitest, jest, pytest, etc.)
 * - Returns structured OrientationResult JSON
 * - Handles non-existent root_path gracefully
 * - Handles non-directory root_path gracefully
 *
 * @ticket TASK-INT-BE043
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  initOrientSchema,
  initOrientHandler,
  detectPackageManager,
  detectFrameworks,
  detectLanguages,
  detectEntryPoints,
  detectTestFramework,
  detectBuildSystem,
  detectKeyDirectories,
  detectConfigFiles,
} from './init-orient.js';
import type { OrientationResult } from './init-orient.js';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../middleware/logging.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Capture the original modules before mocking
const mockExistsSync = vi.fn<(p: string) => boolean>();
const mockStatSync = vi.fn();
const mockReadFileSync = vi.fn<(p: string, enc: string) => string>();

vi.mock('node:fs', () => ({
  existsSync: (p: string) => mockExistsSync(p),
  statSync: (p: string) => mockStatSync(p),
  readFileSync: (p: string, enc: string) => mockReadFileSync(p, enc),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseContent(result: {
  content: Array<{ type: string; [k: string]: unknown }>;
}): Record<string, unknown> {
  const item = result.content[0] as { type: 'text'; text: string };
  return JSON.parse(item.text);
}

/**
 * Set up a virtual filesystem structure for testing.
 *
 * @param files - Map of file path → contents (null = exists but can't be read)
 * @param directories - Set of paths that are directories
 */
function setupVirtualFs(
  files: Map<string, string | null>,
  directories: Set<string> = new Set(),
): void {
  mockExistsSync.mockImplementation((p: string) => {
    return files.has(p) || directories.has(p);
  });

  mockStatSync.mockImplementation((p: string) => {
    if (directories.has(p)) {
      return { isDirectory: () => true, isFile: () => false };
    }
    if (files.has(p)) {
      return { isDirectory: () => false, isFile: () => true };
    }
    const err = new Error(`ENOENT: no such file or directory '${p}'`) as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    throw err;
  });

  mockReadFileSync.mockImplementation((p: string) => {
    const content = files.get(p);
    if (content === undefined) {
      const err = new Error(`ENOENT: no such file or directory '${p}'`) as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    }
    if (content === null) {
      const err = new Error(`EACCES: permission denied '${p}'`) as NodeJS.ErrnoException;
      err.code = 'EACCES';
      throw err;
    }
    return content;
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe('initOrientSchema', () => {
  it('accepts valid root_path', () => {
    const result = initOrientSchema.safeParse({ root_path: '/tmp/project' });
    expect(result.success).toBe(true);
  });

  it('rejects empty root_path', () => {
    const result = initOrientSchema.safeParse({ root_path: '' });
    expect(result.success).toBe(false);
  });

  it('rejects missing root_path', () => {
    const result = initOrientSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('detectPackageManager', () => {
  it('detects pnpm from pnpm-lock.yaml', () => {
    setupVirtualFs(new Map([['/root/pnpm-lock.yaml', '']]));
    expect(detectPackageManager('/root')).toBe('pnpm');
  });

  it('detects yarn from yarn.lock', () => {
    setupVirtualFs(new Map([['/root/yarn.lock', '']]));
    expect(detectPackageManager('/root')).toBe('yarn');
  });

  it('detects npm from package-lock.json', () => {
    setupVirtualFs(new Map([['/root/package-lock.json', '']]));
    expect(detectPackageManager('/root')).toBe('npm');
  });

  it('detects pipenv from Pipfile.lock', () => {
    setupVirtualFs(new Map([['/root/Pipfile.lock', '']]));
    expect(detectPackageManager('/root')).toBe('pipenv');
  });

  it('detects pip from requirements.txt', () => {
    setupVirtualFs(new Map([['/root/requirements.txt', 'flask==2.0']]));
    expect(detectPackageManager('/root')).toBe('pip');
  });

  it('detects poetry from poetry.lock', () => {
    setupVirtualFs(new Map([['/root/poetry.lock', '']]));
    expect(detectPackageManager('/root')).toBe('poetry');
  });

  it('falls back to npm when only package.json exists', () => {
    setupVirtualFs(new Map([['/root/package.json', '{}']]));
    expect(detectPackageManager('/root')).toBe('npm');
  });

  it('returns null when no package manager detected', () => {
    setupVirtualFs(new Map());
    expect(detectPackageManager('/root')).toBeNull();
  });

  it('prioritises pnpm over yarn when both exist', () => {
    setupVirtualFs(
      new Map([
        ['/root/pnpm-lock.yaml', ''],
        ['/root/yarn.lock', ''],
      ]),
    );
    expect(detectPackageManager('/root')).toBe('pnpm');
  });
});

describe('detectFrameworks', () => {
  it('detects Next.js from package.json dependencies', () => {
    setupVirtualFs(
      new Map([
        [
          '/root/package.json',
          JSON.stringify({ dependencies: { next: '14.0.0', react: '18.0.0' } }),
        ],
      ]),
    );
    const result = detectFrameworks('/root');
    expect(result).toContain('Next.js');
    expect(result).toContain('React');
  });

  it('detects Express from devDependencies', () => {
    setupVirtualFs(
      new Map([
        [
          '/root/package.json',
          JSON.stringify({ devDependencies: { express: '4.18.0' } }),
        ],
      ]),
    );
    expect(detectFrameworks('/root')).toContain('Express');
  });

  it('detects Django from requirements.txt', () => {
    setupVirtualFs(
      new Map([['/root/requirements.txt', 'django==4.2\ncelery==5.0']]),
    );
    const result = detectFrameworks('/root');
    expect(result).toContain('Django');
    expect(result).toContain('Celery');
  });

  it('detects FastAPI from pyproject.toml', () => {
    setupVirtualFs(
      new Map([
        ['/root/pyproject.toml', '[tool.poetry.dependencies]\nfastapi = "^0.100"'],
      ]),
    );
    expect(detectFrameworks('/root')).toContain('FastAPI');
  });

  it('returns empty array when no frameworks detected', () => {
    setupVirtualFs(new Map());
    expect(detectFrameworks('/root')).toEqual([]);
  });

  it('returns sorted unique results', () => {
    setupVirtualFs(
      new Map([
        [
          '/root/package.json',
          JSON.stringify({
            dependencies: { react: '18.0', next: '14.0', express: '4.0' },
          }),
        ],
      ]),
    );
    const result = detectFrameworks('/root');
    expect(result).toEqual([...result].sort());
    expect(new Set(result).size).toBe(result.length);
  });
});

describe('detectLanguages', () => {
  it('detects TypeScript from tsconfig.json', () => {
    setupVirtualFs(new Map([['/root/tsconfig.json', '{}']]));
    expect(detectLanguages('/root')).toContain('TypeScript');
  });

  it('detects JavaScript from package.json', () => {
    setupVirtualFs(new Map([['/root/package.json', '{}']]));
    expect(detectLanguages('/root')).toContain('JavaScript');
  });

  it('detects Python from requirements.txt', () => {
    setupVirtualFs(new Map([['/root/requirements.txt', 'flask']]));
    expect(detectLanguages('/root')).toContain('Python');
  });

  it('detects Rust from Cargo.toml', () => {
    setupVirtualFs(new Map([['/root/Cargo.toml', '']]));
    expect(detectLanguages('/root')).toContain('Rust');
  });

  it('detects Go from go.mod', () => {
    setupVirtualFs(new Map([['/root/go.mod', '']]));
    expect(detectLanguages('/root')).toContain('Go');
  });

  it('detects multiple languages', () => {
    setupVirtualFs(
      new Map([
        ['/root/tsconfig.json', '{}'],
        ['/root/package.json', '{}'],
        ['/root/requirements.txt', 'flask'],
      ]),
    );
    const result = detectLanguages('/root');
    expect(result).toContain('TypeScript');
    expect(result).toContain('JavaScript');
    expect(result).toContain('Python');
  });
});

describe('detectEntryPoints', () => {
  it('detects main field from package.json', () => {
    setupVirtualFs(
      new Map([
        ['/root/package.json', JSON.stringify({ main: 'dist/index.js' })],
      ]),
    );
    expect(detectEntryPoints('/root')).toContain('dist/index.js');
  });

  it('detects module field from package.json', () => {
    setupVirtualFs(
      new Map([
        ['/root/package.json', JSON.stringify({ module: 'dist/index.mjs' })],
      ]),
    );
    expect(detectEntryPoints('/root')).toContain('dist/index.mjs');
  });

  it('detects common entry point files', () => {
    setupVirtualFs(
      new Map([
        ['/root/index.ts', ''],
        ['/root/app.py', ''],
      ]),
    );
    const result = detectEntryPoints('/root');
    expect(result).toContain('index.ts');
    expect(result).toContain('app.py');
  });

  it('detects manage.py as entry point', () => {
    setupVirtualFs(new Map([['/root/manage.py', '']]));
    expect(detectEntryPoints('/root')).toContain('manage.py');
  });

  it('does not duplicate when main matches a common file', () => {
    setupVirtualFs(
      new Map([
        ['/root/package.json', JSON.stringify({ main: 'index.js' })],
        ['/root/index.js', ''],
      ]),
    );
    const result = detectEntryPoints('/root');
    const indexJsCount = result.filter((e) => e === 'index.js').length;
    expect(indexJsCount).toBe(1);
  });
});

describe('detectTestFramework', () => {
  it('detects vitest from package.json devDependencies', () => {
    setupVirtualFs(
      new Map([
        [
          '/root/package.json',
          JSON.stringify({ devDependencies: { vitest: '1.0.0' } }),
        ],
      ]),
    );
    expect(detectTestFramework('/root')).toBe('vitest');
  });

  it('detects jest from package.json', () => {
    setupVirtualFs(
      new Map([
        [
          '/root/package.json',
          JSON.stringify({ devDependencies: { jest: '29.0.0' } }),
        ],
      ]),
    );
    expect(detectTestFramework('/root')).toBe('jest');
  });

  it('detects pytest from conftest.py', () => {
    setupVirtualFs(new Map([['/root/conftest.py', '']]));
    expect(detectTestFramework('/root')).toBe('pytest');
  });

  it('detects pytest from requirements.txt', () => {
    setupVirtualFs(
      new Map([['/root/requirements.txt', 'pytest==7.4\nflask==2.0']]),
    );
    expect(detectTestFramework('/root')).toBe('pytest');
  });

  it('detects playwright from @playwright/test', () => {
    setupVirtualFs(
      new Map([
        [
          '/root/package.json',
          JSON.stringify({ devDependencies: { '@playwright/test': '1.40' } }),
        ],
      ]),
    );
    expect(detectTestFramework('/root')).toBe('playwright');
  });

  it('returns null when no test framework found', () => {
    setupVirtualFs(new Map());
    expect(detectTestFramework('/root')).toBeNull();
  });
});

describe('detectBuildSystem', () => {
  it('detects next from build script', () => {
    setupVirtualFs(
      new Map([
        [
          '/root/package.json',
          JSON.stringify({ scripts: { build: 'next build' } }),
        ],
      ]),
    );
    expect(detectBuildSystem('/root')).toBe('next');
  });

  it('detects vite from vite.config.ts', () => {
    setupVirtualFs(new Map([['/root/vite.config.ts', '']]));
    expect(detectBuildSystem('/root')).toBe('vite');
  });

  it('detects make from Makefile', () => {
    setupVirtualFs(new Map([['/root/Makefile', '']]));
    expect(detectBuildSystem('/root')).toBe('make');
  });

  it('detects tsc from build script', () => {
    setupVirtualFs(
      new Map([
        [
          '/root/package.json',
          JSON.stringify({ scripts: { build: 'tsc --project tsconfig.build.json' } }),
        ],
      ]),
    );
    expect(detectBuildSystem('/root')).toBe('tsc');
  });

  it('returns null when no build system found', () => {
    setupVirtualFs(new Map());
    expect(detectBuildSystem('/root')).toBeNull();
  });
});

describe('detectKeyDirectories', () => {
  it('finds existing directories', () => {
    setupVirtualFs(
      new Map(),
      new Set(['/root/src', '/root/tests', '/root/docs']),
    );
    const result = detectKeyDirectories('/root');
    expect(result).toContain('src');
    expect(result).toContain('tests');
    expect(result).toContain('docs');
  });

  it('returns empty when no key directories exist', () => {
    setupVirtualFs(new Map());
    expect(detectKeyDirectories('/root')).toEqual([]);
  });
});

describe('detectConfigFiles', () => {
  it('finds existing config files', () => {
    setupVirtualFs(
      new Map([
        ['/root/tsconfig.json', '{}'],
        ['/root/docker-compose.yml', ''],
        ['/root/.env', ''],
      ]),
    );
    const result = detectConfigFiles('/root');
    expect(result).toContain('tsconfig.json');
    expect(result).toContain('docker-compose.yml');
    expect(result).toContain('.env');
  });

  it('returns empty when no config files exist', () => {
    setupVirtualFs(new Map());
    expect(detectConfigFiles('/root')).toEqual([]);
  });
});

describe('initOrientHandler', () => {
  it('returns full orientation for a Node.js + TypeScript project', async () => {
    const pkgJson = JSON.stringify({
      name: 'my-awesome-app',
      main: 'dist/index.js',
      dependencies: { next: '14.0', react: '18.0' },
      devDependencies: { vitest: '1.0', typescript: '5.0' },
      scripts: { build: 'next build' },
    });

    const files = new Map<string, string | null>([
      ['/project/package.json', pkgJson],
      ['/project/package-lock.json', ''],
      ['/project/tsconfig.json', '{}'],
      ['/project/vitest.config.ts', ''],
      ['/project/src/index.ts', ''],
    ]);

    const dirs = new Set([
      '/project',
      '/project/src',
      '/project/components',
      '/project/tests',
    ]);

    setupVirtualFs(files, dirs);

    const result = await initOrientHandler({ root_path: '/project' });
    expect(result.isError).toBeUndefined();

    const data = parseContent(result) as OrientationResult;
    expect(data.project_name).toBe('my-awesome-app');
    expect(data.package_manager).toBe('npm');
    expect(data.frameworks).toContain('Next.js');
    expect(data.frameworks).toContain('React');
    expect(data.languages).toContain('TypeScript');
    expect(data.languages).toContain('JavaScript');
    expect(data.entry_points).toContain('dist/index.js');
    expect(data.entry_points).toContain('src/index.ts');
    expect(data.test_framework).toBe('vitest');
    expect(data.build_system).toBe('next');
    expect(data.key_directories).toContain('src');
    expect(data.key_directories).toContain('components');
    expect(data.key_directories).toContain('tests');
    expect(data.config_files).toContain('tsconfig.json');
    expect(data.config_files).toContain('vitest.config.ts');
  });

  it('returns full orientation for a Python Django project', async () => {
    const files = new Map<string, string | null>([
      ['/pyproject/requirements.txt', 'django==4.2\npytest==7.4\ncelery==5.0'],
      ['/pyproject/manage.py', '#!/usr/bin/env python'],
      ['/pyproject/conftest.py', ''],
      ['/pyproject/Makefile', ''],
    ]);

    const dirs = new Set([
      '/pyproject',
      '/pyproject/app',
      '/pyproject/tests',
      '/pyproject/config',
    ]);

    setupVirtualFs(files, dirs);

    const result = await initOrientHandler({ root_path: '/pyproject' });
    expect(result.isError).toBeUndefined();

    const data = parseContent(result) as OrientationResult;
    expect(data.project_name).toBe('pyproject');
    expect(data.package_manager).toBe('pip');
    expect(data.frameworks).toContain('Django');
    expect(data.frameworks).toContain('Celery');
    expect(data.languages).toContain('Python');
    expect(data.entry_points).toContain('manage.py');
    expect(data.test_framework).toBe('pytest');
    expect(data.build_system).toBe('make');
    expect(data.key_directories).toContain('app');
    expect(data.key_directories).toContain('tests');
    expect(data.key_directories).toContain('config');
  });

  it('returns error when root_path does not exist', async () => {
    mockStatSync.mockImplementation(() => {
      const err = new Error('ENOENT') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    });

    const result = await initOrientHandler({ root_path: '/nonexistent' });
    expect(result.isError).toBe(true);
    const data = parseContent(result);
    expect(data.error).toBe('Orientation failed');
  });

  it('returns error when root_path is a file, not a directory', async () => {
    mockStatSync.mockReturnValue({
      isDirectory: () => false,
      isFile: () => true,
    });

    const result = await initOrientHandler({ root_path: '/some/file.txt' });
    expect(result.isError).toBe(true);
    const data = parseContent(result);
    expect(data.error).toBe('root_path is not a directory');
  });

  it('falls back to directory basename when no package.json', async () => {
    setupVirtualFs(new Map(), new Set(['/my-project']));

    const result = await initOrientHandler({ root_path: '/my-project' });
    expect(result.isError).toBeUndefined();

    const data = parseContent(result) as OrientationResult;
    expect(data.project_name).toBe('my-project');
    expect(data.package_manager).toBeNull();
    expect(data.frameworks).toEqual([]);
    expect(data.test_framework).toBeNull();
    expect(data.build_system).toBeNull();
  });

  it('handles a minimal empty project', async () => {
    setupVirtualFs(new Map(), new Set(['/empty']));

    const result = await initOrientHandler({ root_path: '/empty' });
    expect(result.isError).toBeUndefined();

    const data = parseContent(result) as OrientationResult;
    expect(data.project_name).toBe('empty');
    expect(data.package_manager).toBeNull();
    expect(data.frameworks).toEqual([]);
    expect(data.languages).toEqual([]);
    expect(data.entry_points).toEqual([]);
    expect(data.test_framework).toBeNull();
    expect(data.build_system).toBeNull();
    expect(data.key_directories).toEqual([]);
    expect(data.config_files).toEqual([]);
  });

  it('handles malformed package.json gracefully', async () => {
    setupVirtualFs(
      new Map([
        ['/broken/package.json', '{ invalid json !!!'],
      ]),
      new Set(['/broken']),
    );

    const result = await initOrientHandler({ root_path: '/broken' });
    expect(result.isError).toBeUndefined();

    const data = parseContent(result) as OrientationResult;
    // Falls back to dirname since package.json is unparseable
    expect(data.project_name).toBe('broken');
    // Still detects npm since package.json exists
    expect(data.package_manager).toBe('npm');
  });
});
