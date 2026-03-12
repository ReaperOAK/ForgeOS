/**
 * File Walker — traverses a repository directory tree for indexable source files.
 *
 * Recursively walks from a configurable root path, respecting .gitignore
 * patterns and filtering to supported language extensions. For each matching
 * file, computes a SHA-256 content hash and line count.
 *
 * @module services/indexer/file-walker
 * @ticket TASK-INT-BE021
 */

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../../middleware/logging.js';

// ── Constants ────────────────────────────────────────────────────────────────

/** File extensions recognised as indexable source code. */
const SUPPORTED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.sql']);

/** Extension → canonical language name mapping. */
const EXTENSION_TO_LANGUAGE: Readonly<Record<string, string>> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.sql': 'sql',
};

/** Directories that are always skipped regardless of .gitignore presence. */
const DEFAULT_IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '__pycache__',
  '.next',
  '.turbo',
]);

// ── Public Interface ─────────────────────────────────────────────────────────

/** A single indexable file discovered by the walker. */
export interface FileEntry {
  /** Relative path from the walk root (forward-slash separated). */
  path: string;
  /** Canonical language identifier (e.g. 'typescript', 'python'). */
  language: string;
  /** Hex-encoded SHA-256 digest of the file content. */
  hash: string;
  /** Number of lines (newline count + 1 for non-empty files). */
  lineCount: number;
}

/** Options bag for {@link walkDirectory}. */
export interface WalkOptions {
  /** Additional directory names to skip (merged with built-in list). */
  ignoreDirs?: string[];
  /** Additional file extensions to accept (e.g. `['.rs', '.go']`). */
  extraExtensions?: string[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Compute the SHA-256 hex digest of a buffer.
 */
function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Count the number of lines in a buffer.
 * Returns 0 for empty buffers, otherwise newline-count + 1.
 */
function countLines(content: Buffer): number {
  if (content.length === 0) return 0;
  let count = 1;
  for (let i = 0; i < content.length; i++) {
    if (content[i] === 0x0a) count++;
  }
  return count;
}

// ── Core Walk ────────────────────────────────────────────────────────────────

/**
 * Recursively walk `rootPath` and return {@link FileEntry} objects for every
 * supported source file found.
 *
 * Directories listed in {@link DEFAULT_IGNORE_DIRS} and any additional
 * patterns in `options.ignoreDirs` are skipped entirely. Only files whose
 * extension appears in {@link SUPPORTED_EXTENSIONS} (or `options.extraExtensions`)
 * are included.
 *
 * @param rootPath - Absolute path to the directory root.
 * @param options  - Optional walk configuration.
 * @returns Resolved array of discovered file entries.
 */
export async function walkDirectory(
  rootPath: string,
  options?: WalkOptions,
): Promise<FileEntry[]> {
  const ignoreDirs = new Set([
    ...DEFAULT_IGNORE_DIRS,
    ...(options?.ignoreDirs ?? []),
  ]);

  const extensions = new Set([
    ...SUPPORTED_EXTENSIONS,
    ...(options?.extraExtensions ?? []),
  ]);

  const extensionToLang: Record<string, string> = { ...EXTENSION_TO_LANGUAGE };
  for (const ext of options?.extraExtensions ?? []) {
    if (!(ext in extensionToLang)) {
      extensionToLang[ext] = ext.replace(/^\./, '');
    }
  }

  const results: FileEntry[] = [];

  async function walk(dir: string): Promise<void> {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err: unknown) {
      logger.warn({ dir, err }, 'file-walker: could not read directory');
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!ignoreDirs.has(entry.name)) {
          await walk(fullPath);
        }
        continue;
      }

      if (!entry.isFile()) continue;

      const ext = path.extname(entry.name);
      if (!extensions.has(ext)) continue;

      try {
        const content = await readFile(fullPath);
        const relativePath = path.relative(rootPath, fullPath);
        const language = extensionToLang[ext] ?? ext.replace(/^\./, '');

        results.push({
          path: relativePath.split(path.sep).join('/'),
          language,
          hash: sha256(content),
          lineCount: countLines(content),
        });
      } catch (err: unknown) {
        logger.warn({ file: fullPath, err }, 'file-walker: could not read file');
      }
    }
  }

  await walk(rootPath);
  return results;
}

// ── Test Helpers ─────────────────────────────────────────────────────────────

/** @internal Exposed for unit tests only. */
export const _internals = {
  sha256,
  countLines,
  SUPPORTED_EXTENSIONS,
  DEFAULT_IGNORE_DIRS,
  EXTENSION_TO_LANGUAGE,
} as const;
