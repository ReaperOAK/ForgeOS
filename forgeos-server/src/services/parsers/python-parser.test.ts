/**
 * Unit tests for the Python AST parser.
 *
 * @ticket TASK-INT-BE023
 */

import { describe, it, expect } from 'vitest';
import { parsePython } from './python-parser.js';

describe('python-parser', () => {
    // ── Function Extraction ──────────────────────────────────────────────────

    describe('function extraction', () => {
        it('extracts a simple function definition', async () => {
            const source = `def greet(name: str) -> str:\n    return f"Hello, {name}"`;
            const result = await parsePython(source);

            expect(result.symbols).toHaveLength(1);
      const fn = result.symbols[0]!;
      expect(fn.name).toBe('greet');
      expect(fn.qualified_name).toBe('greet');
      expect(fn.kind).toBe('function');
      expect(fn.start_line).toBe(1);
      expect(fn.end_line).toBe(2);
      expect(fn.signature).toContain('def greet');
      expect(fn.signature).toContain('name: str');
    });

    it('extracts multiple top-level functions', async () => {
      const source = [
        'def add(a, b):',
        '    return a + b',
        '',
        'def subtract(a, b):',
        '    return a - b',
      ].join('\n');
      const result = await parsePython(source);

      expect(result.symbols).toHaveLength(2);
      expect(result.symbols[0]!.name).toBe('add');
      expect(result.symbols[1]!.name).toBe('subtract');
    });

    it('extracts function with return type annotation', async () => {
      const source = 'def compute(x: int, y: int) -> float:\n    return x / y';
      const result = await parsePython(source);

      const fn = result.symbols[0]!;
      expect(fn.signature).toContain('-> float');
    });
  });

  // ── Class Extraction ─────────────────────────────────────────────────────

  describe('class extraction', () => {
    it('extracts a class with methods as children', async () => {
      const source = [
        'class Calculator:',
        '    def __init__(self):',
        '        self.result = 0',
        '',
        '    def add(self, x):',
        '        self.result += x',
        '        return self',
      ].join('\n');
      const result = await parsePython(source);

      expect(result.symbols).toHaveLength(1);
      const cls = result.symbols[0]!;
      expect(cls.name).toBe('Calculator');
      expect(cls.kind).toBe('class');
      expect(cls.signature).toContain('class Calculator');

      expect(cls.children).toHaveLength(2);
      expect(cls.children[0]!.name).toBe('__init__');
      expect(cls.children[0]!.kind).toBe('method');
      expect(cls.children[0]!.qualified_name).toBe('Calculator.__init__');
      expect(cls.children[1]!.name).toBe('add');
      expect(cls.children[1]!.kind).toBe('method');
      expect(cls.children[1]!.qualified_name).toBe('Calculator.add');
    });

    it('extracts class with superclass', async () => {
      const source = [
        'class Dog(Animal):',
        '    def bark(self):',
        '        print("Woof")',
      ].join('\n');
      const result = await parsePython(source);

      const cls = result.symbols[0]!;
      expect(cls.name).toBe('Dog');
      expect(cls.signature).toContain('(Animal)');
      expect(cls.children).toHaveLength(1);
      expect(cls.children[0]!.name).toBe('bark');
    });
  });

  // ── Decorator Handling ───────────────────────────────────────────────────

  describe('decorator handling', () => {
    it('extracts decorated function with decorator in signature', async () => {
      const source = [
        '@staticmethod',
        'def create():',
        '    pass',
      ].join('\n');
      const result = await parsePython(source);

      expect(result.symbols).toHaveLength(1);
      const fn = result.symbols[0]!;
      expect(fn.name).toBe('create');
      expect(fn.kind).toBe('function');
      expect(fn.signature).toContain('@staticmethod');
    });

    it('extracts decorated class with decorator in signature', async () => {
      const source = [
        '@dataclass',
        'class Point:',
        '    x: float',
        '    y: float',
      ].join('\n');
      const result = await parsePython(source);

      expect(result.symbols).toHaveLength(1);
      const cls = result.symbols[0]!;
      expect(cls.name).toBe('Point');
      expect(cls.kind).toBe('class');
      expect(cls.signature).toContain('@dataclass');
    });

    it('handles nested decorated methods inside a class', async () => {
      const source = [
        'class MyService:',
        '    @property',
        '    def name(self):',
        '        return self._name',
        '',
        '    @classmethod',
        '    def create(cls):',
        '        return cls()',
      ].join('\n');
      const result = await parsePython(source);

      const cls = result.symbols[0]!;
      expect(cls.children).toHaveLength(2);
      expect(cls.children[0]!.name).toBe('name');
      expect(cls.children[0]!.signature).toContain('@property');
      expect(cls.children[1]!.name).toBe('create');
      expect(cls.children[1]!.signature).toContain('@classmethod');
    });
  });

  // ── Import Extraction ────────────────────────────────────────────────────

  describe('import extraction', () => {
    it('extracts simple import statement', async () => {
      const source = 'import os';
      const result = await parsePython(source);

      expect(result.imports).toHaveLength(1);
      const imp = result.imports[0]!;
      expect(imp.source_path).toBe('os');
      expect(imp.imported_name).toBeNull();
      expect(imp.is_namespace).toBe(true);
    });

    it('extracts import with alias', async () => {
      const source = 'import numpy as np';
      const result = await parsePython(source);

      expect(result.imports).toHaveLength(1);
      const imp = result.imports[0]!;
      expect(imp.source_path).toBe('numpy');
      expect(imp.alias).toBe('np');
      expect(imp.is_namespace).toBe(true);
    });

    it('extracts from-import statement', async () => {
      const source = 'from os import path';
      const result = await parsePython(source);

      expect(result.imports).toHaveLength(1);
      const imp = result.imports[0]!;
      expect(imp.source_path).toBe('os');
      expect(imp.imported_name).toBe('path');
      expect(imp.is_namespace).toBe(false);
    });

    it('extracts from-import with alias', async () => {
      const source = 'from collections import OrderedDict as OD';
      const result = await parsePython(source);

      expect(result.imports).toHaveLength(1);
      const imp = result.imports[0]!;
      expect(imp.source_path).toBe('collections');
      expect(imp.imported_name).toBe('OrderedDict');
      expect(imp.alias).toBe('OD');
    });

    it('extracts wildcard import', async () => {
      const source = 'from typing import *';
      const result = await parsePython(source);

      expect(result.imports).toHaveLength(1);
      const imp = result.imports[0]!;
      expect(imp.source_path).toBe('typing');
      expect(imp.imported_name).toBe('*');
      expect(imp.is_namespace).toBe(true);
    });

    it('extracts multiple from-import names', async () => {
      const source = 'from typing import List, Dict, Optional';
      const result = await parsePython(source);

      expect(result.imports).toHaveLength(3);
      expect(result.imports[0]!.imported_name).toBe('List');
      expect(result.imports[1]!.imported_name).toBe('Dict');
      expect(result.imports[2]!.imported_name).toBe('Optional');
      for (const imp of result.imports) {
        expect(imp.source_path).toBe('typing');
      }
    });
  });

  // ── Mixed Content ────────────────────────────────────────────────────────

  describe('mixed content', () => {
    it('extracts symbols and imports from a realistic Python file', async () => {
      const source = [
        'import os',
        'from typing import List, Optional',
        'from dataclasses import dataclass',
        '',
        '@dataclass',
        'class User:',
        '    name: str',
        '    email: str',
        '',
        '    def display(self) -> str:',
        '        return f"{self.name} <{self.email}>"',
        '',
        'class UserService:',
        '    def __init__(self, db):',
        '        self._db = db',
        '',
        '    def find_by_email(self, email: str) -> Optional[User]:',
        '        pass',
        '',
        '    @staticmethod',
        '    def validate(email: str) -> bool:',
        '        return "@" in email',
        '',
        'def main():',
        '    svc = UserService(None)',
        '    print(svc.find_by_email("test@test.com"))',
      ].join('\n');

      const result = await parsePython(source);

      // Imports: os, List, Optional, dataclass
      expect(result.imports).toHaveLength(4);

      // Top-level symbols: User, UserService, main
      expect(result.symbols).toHaveLength(3);

      const user = result.symbols[0]!;
      expect(user.name).toBe('User');
      expect(user.kind).toBe('class');
      expect(user.children).toHaveLength(1);
      expect(user.children[0]!.name).toBe('display');

      const svc = result.symbols[1]!;
      expect(svc.name).toBe('UserService');
      expect(svc.children).toHaveLength(3);

      const mainFn = result.symbols[2]!;
      expect(mainFn.name).toBe('main');
      expect(mainFn.kind).toBe('function');
    });
  });

  // ── Edge Cases ───────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('returns empty result for empty source', async () => {
      const result = await parsePython('');
      expect(result.symbols).toHaveLength(0);
      expect(result.imports).toHaveLength(0);
    });

    it('returns empty symbols for source with only comments', async () => {
      const source = '# This is a comment\n# Another comment\n';
      const result = await parsePython(source);
      expect(result.symbols).toHaveLength(0);
    });

    it('handles nested classes', async () => {
      const source = [
        'class Outer:',
        '    class Inner:',
        '        def method(self):',
        '            pass',
      ].join('\n');
      const result = await parsePython(source);

      expect(result.symbols).toHaveLength(1);
      const outer = result.symbols[0]!;
      expect(outer.name).toBe('Outer');
      expect(outer.children).toHaveLength(1);

      const inner = outer.children[0]!;
      expect(inner.name).toBe('Inner');
      expect(inner.kind).toBe('class');
      expect(inner.qualified_name).toBe('Outer.Inner');
      expect(inner.children).toHaveLength(1);
      expect(inner.children[0]!.qualified_name).toBe('Outer.Inner.method');
    });
  });
});
