/**
 * Unit tests for the tree-sitter WASM grammar loader service.
 *
 * @ticket TASK-INT-DO001
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  getParser,
  getSupportedLanguages,
  getAvailableLanguages,
  isLanguageAvailable,
  _resetForTesting,
} from './wasm-loader.js';

afterEach(() => {
  _resetForTesting();
});

describe('wasm-loader', () => {
  describe('getSupportedLanguages', () => {
    it('returns the canonical language list', () => {
      const langs = getSupportedLanguages();
      expect(langs).toContain('typescript');
      expect(langs).toContain('javascript');
      expect(langs).toContain('python');
      expect(langs).toContain('sql');
    });
  });

  describe('getAvailableLanguages', () => {
    it('returns only languages with WASM files on disk', () => {
      const available = getAvailableLanguages();
      // TypeScript, JavaScript, Python should be present (committed WASMs)
      expect(available).toContain('typescript');
      expect(available).toContain('javascript');
      expect(available).toContain('python');
    });
  });

  describe('isLanguageAvailable', () => {
    it('returns true for TypeScript', () => {
      expect(isLanguageAvailable('typescript')).toBe(true);
    });

    it('returns false for a non-existent language', () => {
      expect(isLanguageAvailable('brainfuck')).toBe(false);
    });
  });

  describe('getParser', () => {
    it('loads the TypeScript grammar and parses a simple file', async () => {
      const parser = await getParser('typescript');
      expect(parser).toBeDefined();

      const source = 'const x: number = 42;\nfunction hello(): string { return "hi"; }';
      const tree = parser.parse(source);

      expect(tree).toBeDefined();
      expect(tree.rootNode).toBeDefined();
      expect(tree.rootNode.type).toBe('program');
      // A program with two statements should have at least 2 child nodes
      expect(tree.rootNode.childCount).toBeGreaterThanOrEqual(2);

      tree.delete();
    });

    it('returns cached parser on second call', async () => {
      const p1 = await getParser('typescript');
      const p2 = await getParser('typescript');
      expect(p1).toBe(p2);
    });

    it('loads the JavaScript grammar', async () => {
      const parser = await getParser('javascript');
      const tree = parser.parse('const a = 1;');
      expect(tree.rootNode.type).toBe('program');
      expect(tree.rootNode.childCount).toBeGreaterThanOrEqual(1);
      tree.delete();
    });

    it('loads the Python grammar', async () => {
      const parser = await getParser('python');
      const tree = parser.parse('def greet(name):\n    return f"Hello, {name}"');
      expect(tree.rootNode.type).toBe('module');
      expect(tree.rootNode.childCount).toBeGreaterThanOrEqual(1);
      tree.delete();
    });

    it('throws a clear error for a missing grammar file', async () => {
      await expect(getParser('cobol')).rejects.toThrow(/Grammar WASM not found/);
    });
  });

  describe('TypeScript AST structure', () => {
    it('produces expected AST node count for a simple program', async () => {
      const parser = await getParser('typescript');
      const source = 'const x: number = 42;';
      const tree = parser.parse(source);

      // Walk the tree and count nodes
      let nodeCount = 0;
      const cursor = tree.walk();
      const visited = new Set<number>();

      function countNodes(): void {
        if (visited.has(cursor.nodeId)) return;
        visited.add(cursor.nodeId);
        nodeCount++;
        if (cursor.gotoFirstChild()) {
          do {
            countNodes();
          } while (cursor.gotoNextSibling());
          cursor.gotoParent();
        }
      }
      countNodes();

      // `const x: number = 42;` should produce a reasonable AST
      // program -> lexical_declaration -> variable_declarator -> ...
      expect(nodeCount).toBeGreaterThanOrEqual(5);

      cursor.delete();
      tree.delete();
    });
  });
});
