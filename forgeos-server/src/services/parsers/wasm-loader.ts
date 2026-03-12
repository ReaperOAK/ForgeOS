/**
 * Tree-sitter WASM Grammar Loader Service
 *
 * Lazily initializes tree-sitter parsers for supported languages.
 * Grammar WASM files are loaded from the `grammars/` directory relative
 * to this module. Parsers are cached after first initialization so
 * subsequent calls return immediately.
 *
 * @ticket TASK-INT-DO001
 */

import Parser from 'web-tree-sitter';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { existsSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GRAMMARS_DIR = path.join(__dirname, 'grammars');

/**
 * Canonical list of languages with grammar WASM files.
 * Languages are only usable if their `.wasm` file exists in the grammars dir.
 */
const SUPPORTED_LANGUAGES = ['typescript', 'javascript', 'python', 'sql'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/** Cached parser instances keyed by language name. */
const parsers = new Map<string, Parser>();

/** Whether Parser.init() has been called. */
let initialized = false;

/**
 * Resolve the filesystem path to a grammar WASM file.
 */
function grammarPath(language: string): string {
  return path.join(GRAMMARS_DIR, `tree-sitter-${language}.wasm`);
}

/**
 * Ensure the core web-tree-sitter runtime is initialized (once).
 */
async function ensureInit(): Promise<void> {
  if (initialized) return;
  await Parser.init();
  initialized = true;
}

/**
 * Get (or create) a tree-sitter parser for the given language.
 *
 * On first call for a language the grammar WASM is loaded from disk;
 * subsequent calls return the cached parser instantly.
 *
 * @throws {Error} If the grammar file does not exist or fails to load.
 */
export async function getParser(language: string): Promise<Parser> {
  const cached = parsers.get(language);
  if (cached) return cached;

  const wasmFile = grammarPath(language);
  if (!existsSync(wasmFile)) {
    throw new Error(
      `Grammar WASM not found for "${language}" at ${wasmFile}. ` +
        'Run `npm run grammars:setup` to download grammar files.',
    );
  }

  await ensureInit();

  const parser = new Parser();
  const lang = await Parser.Language.load(wasmFile);
  parser.setLanguage(lang);

  parsers.set(language, parser);
  return parser;
}

/**
 * Check whether a grammar WASM file exists for the given language.
 */
export function isLanguageAvailable(language: string): boolean {
  return existsSync(grammarPath(language));
}

/**
 * List all declared supported languages.
 */
export function getSupportedLanguages(): readonly string[] {
  return SUPPORTED_LANGUAGES;
}

/**
 * List supported languages that actually have grammar WASM files on disk.
 */
export function getAvailableLanguages(): string[] {
  return SUPPORTED_LANGUAGES.filter((lang) => existsSync(grammarPath(lang)));
}

/**
 * Reset internal state. Intended for tests only.
 */
export function _resetForTesting(): void {
  for (const parser of parsers.values()) {
    parser.delete();
  }
  parsers.clear();
  initialized = false;
}
