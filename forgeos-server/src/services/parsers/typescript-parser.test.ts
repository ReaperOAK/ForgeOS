/**
 * Unit tests for the TypeScript/JavaScript AST parser.
 *
 * @ticket TASK-INT-BE022
 */

import { describe, it, expect } from 'vitest';
import {
  parseTypeScript,
  type CodeSymbol,
  type CodeImport,
  type ParseResult,
} from './typescript-parser.js';

// ── Helper ───────────────────────────────────────────────────────────────────

function findSymbol(result: ParseResult, name: string): CodeSymbol | undefined {
  return result.symbols.find((s) => s.name === name);
}

function findImport(result: ParseResult, targetPath: string): CodeImport | undefined {
  return result.imports.find((i) => i.targetPath === targetPath);
}

// ── Function Declarations ────────────────────────────────────────────────────

describe('parseTypeScript', () => {
  describe('function declarations', () => {
    it('extracts a simple function declaration', async () => {
      const source = `function greet(name: string): string {
  return \`Hello, \${name}\`;
}`;
      const result = await parseTypeScript(source, 'test.ts');

      const sym = findSymbol(result, 'greet');
      expect(sym).toBeDefined();
      expect(sym!.kind).toBe('function');
      expect(sym!.startLine).toBe(1);
      expect(sym!.endLine).toBe(3);
      expect(sym!.exported).toBe(false);
      expect(sym!.qualifiedName).toBe('greet');
      expect(sym!.signature).toContain('greet');
    });

    it('extracts an exported function declaration', async () => {
      const source = `export function add(a: number, b: number): number {
  return a + b;
}`;
      const result = await parseTypeScript(source, 'test.ts');

      const sym = findSymbol(result, 'add');
      expect(sym).toBeDefined();
      expect(sym!.exported).toBe(true);
      expect(sym!.kind).toBe('function');
    });

    it('extracts an async function declaration', async () => {
      const source = `export async function fetchData(url: string): Promise<Response> {
  return fetch(url);
}`;
      const result = await parseTypeScript(source, 'test.ts');

      const sym = findSymbol(result, 'fetchData');
      expect(sym).toBeDefined();
      expect(sym!.kind).toBe('function');
      expect(sym!.exported).toBe(true);
    });
  });

  // ── Arrow Functions as const ────────────────────────────────────────────

  describe('arrow functions assigned to const', () => {
    it('extracts a const arrow function', async () => {
      const source = `const multiply = (a: number, b: number): number => a * b;`;
      const result = await parseTypeScript(source, 'test.ts');

      const sym = findSymbol(result, 'multiply');
      expect(sym).toBeDefined();
      expect(sym!.kind).toBe('variable');
      expect(sym!.exported).toBe(false);
    });

    it('extracts an exported const arrow function', async () => {
      const source = `export const divide = (a: number, b: number): number => a / b;`;
      const result = await parseTypeScript(source, 'test.ts');

      const sym = findSymbol(result, 'divide');
      expect(sym).toBeDefined();
      expect(sym!.exported).toBe(true);
    });
  });

  // ── Class Declarations ─────────────────────────────────────────────────

  describe('class declarations', () => {
    it('extracts a class with methods and qualified names', async () => {
      const source = `export class UserService {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async findById(id: string): Promise<User | null> {
    return this.db.query(id);
  }

  async create(data: CreateUserDto): Promise<User> {
    return this.db.insert(data);
  }
}`;
      const result = await parseTypeScript(source, 'test.ts');

      // Class itself
      const classSym = findSymbol(result, 'UserService');
      expect(classSym).toBeDefined();
      expect(classSym!.kind).toBe('class');
      expect(classSym!.exported).toBe(true);

      // Methods have qualified names
      const findByIdSym = result.symbols.find(
        (s) => s.qualifiedName === 'UserService.findById',
      );
      expect(findByIdSym).toBeDefined();
      expect(findByIdSym!.kind).toBe('method');
      expect(findByIdSym!.name).toBe('findById');

      const createSym = result.symbols.find(
        (s) => s.qualifiedName === 'UserService.create',
      );
      expect(createSym).toBeDefined();
      expect(createSym!.kind).toBe('method');

      // Constructor
      const ctorSym = result.symbols.find(
        (s) => s.qualifiedName === 'UserService.constructor',
      );
      expect(ctorSym).toBeDefined();
      expect(ctorSym!.kind).toBe('method');
    });

    it('extracts class properties', async () => {
      const source = `class Config {
  readonly host: string = 'localhost';
  port: number = 3011;
}`;
      const result = await parseTypeScript(source, 'test.ts');

      const classSym = findSymbol(result, 'Config');
      expect(classSym).toBeDefined();
      expect(classSym!.kind).toBe('class');
      expect(classSym!.exported).toBe(false);
    });
  });

  // ── Interface Declarations ─────────────────────────────────────────────

  describe('interface declarations', () => {
    it('extracts an interface declaration', async () => {
      const source = `export interface UserDto {
  id: string;
  name: string;
  email: string;
}`;
      const result = await parseTypeScript(source, 'test.ts');

      const sym = findSymbol(result, 'UserDto');
      expect(sym).toBeDefined();
      expect(sym!.kind).toBe('interface');
      expect(sym!.exported).toBe(true);
      expect(sym!.startLine).toBe(1);
      expect(sym!.endLine).toBe(5);
    });
  });

  // ── Type Alias Declarations ────────────────────────────────────────────

  describe('type alias declarations', () => {
    it('extracts a type alias declaration', async () => {
      const source = `export type UserId = string;`;
      const result = await parseTypeScript(source, 'test.ts');

      const sym = findSymbol(result, 'UserId');
      expect(sym).toBeDefined();
      expect(sym!.kind).toBe('type');
      expect(sym!.exported).toBe(true);
    });

    it('extracts a complex union type alias', async () => {
      const source = `type Status = 'active' | 'inactive' | 'pending';`;
      const result = await parseTypeScript(source, 'test.ts');

      const sym = findSymbol(result, 'Status');
      expect(sym).toBeDefined();
      expect(sym!.kind).toBe('type');
      expect(sym!.exported).toBe(false);
    });
  });

  // ── Import Statements ──────────────────────────────────────────────────

  describe('import statements', () => {
    it('extracts named imports', async () => {
      const source = `import { foo, bar } from './utils/helper';`;
      const result = await parseTypeScript(source, 'test.ts');

      const imp = findImport(result, './utils/helper');
      expect(imp).toBeDefined();
      expect(imp!.importNames).toEqual(expect.arrayContaining(['foo', 'bar']));
      expect(imp!.isDefaultImport).toBe(false);
    });

    it('extracts default imports', async () => {
      const source = `import React from 'react';`;
      const result = await parseTypeScript(source, 'test.ts');

      const imp = findImport(result, 'react');
      expect(imp).toBeDefined();
      expect(imp!.importNames).toEqual(['React']);
      expect(imp!.isDefaultImport).toBe(true);
    });

    it('extracts namespace imports', async () => {
      const source = `import * as path from 'node:path';`;
      const result = await parseTypeScript(source, 'test.ts');

      const imp = findImport(result, 'node:path');
      expect(imp).toBeDefined();
      expect(imp!.importNames).toEqual(['path']);
      expect(imp!.isDefaultImport).toBe(false);
    });

    it('extracts mixed default and named imports', async () => {
      const source = `import React, { useState, useEffect } from 'react';`;
      const result = await parseTypeScript(source, 'test.ts');

      // Should produce at least the import from 'react'
      const imports = result.imports.filter((i) => i.targetPath === 'react');
      expect(imports.length).toBeGreaterThanOrEqual(1);

      const allNames = imports.flatMap((i) => i.importNames);
      expect(allNames).toContain('React');
      expect(allNames).toContain('useState');
      expect(allNames).toContain('useEffect');
    });

    it('extracts type-only imports', async () => {
      const source = `import type { Config } from './config';`;
      const result = await parseTypeScript(source, 'test.ts');

      const imp = findImport(result, './config');
      expect(imp).toBeDefined();
      expect(imp!.importNames).toContain('Config');
    });
  });

  // ── Export Statements ──────────────────────────────────────────────────

  describe('export statements', () => {
    it('detects inline export on function', async () => {
      const source = `export function helper(): void {}`;
      const result = await parseTypeScript(source, 'test.ts');

      const sym = findSymbol(result, 'helper');
      expect(sym).toBeDefined();
      expect(sym!.exported).toBe(true);
    });

    it('detects export default function', async () => {
      const source = `export default function main(): void {}`;
      const result = await parseTypeScript(source, 'test.ts');

      const sym = findSymbol(result, 'main');
      expect(sym).toBeDefined();
      expect(sym!.exported).toBe(true);
    });

    it('detects re-exports', async () => {
      const source = `export { foo, bar } from './other';`;
      const result = await parseTypeScript(source, 'test.ts');

      const imp = findImport(result, './other');
      expect(imp).toBeDefined();
      expect(imp!.importNames).toEqual(expect.arrayContaining(['foo', 'bar']));
    });

    it('detects export default class', async () => {
      const source = `export default class App {
  render(): void {}
}`;
      const result = await parseTypeScript(source, 'test.ts');

      const sym = findSymbol(result, 'App');
      expect(sym).toBeDefined();
      expect(sym!.exported).toBe(true);
      expect(sym!.kind).toBe('class');
    });
  });

  // ── Variable Declarations ──────────────────────────────────────────────

  describe('variable/constant declarations', () => {
    it('extracts exported const declarations', async () => {
      const source = `export const MAX_RETRIES = 3;`;
      const result = await parseTypeScript(source, 'test.ts');

      const sym = findSymbol(result, 'MAX_RETRIES');
      expect(sym).toBeDefined();
      expect(sym!.kind).toBe('variable');
      expect(sym!.exported).toBe(true);
    });
  });

  // ── Enum Declarations ──────────────────────────────────────────────────

  describe('enum declarations', () => {
    it('extracts enum declarations', async () => {
      const source = `export enum Direction {
  Up = 'UP',
  Down = 'DOWN',
  Left = 'LEFT',
  Right = 'RIGHT',
}`;
      const result = await parseTypeScript(source, 'test.ts');

      const sym = findSymbol(result, 'Direction');
      expect(sym).toBeDefined();
      expect(sym!.kind).toBe('variable');
      expect(sym!.exported).toBe(true);
    });
  });

  // ── JavaScript Files ───────────────────────────────────────────────────

  describe('JavaScript file parsing', () => {
    it('parses a .js file with the JavaScript grammar', async () => {
      const source = `function add(a, b) {
  return a + b;
}

module.exports = { add };`;
      const result = await parseTypeScript(source, 'utils.js');

      const sym = findSymbol(result, 'add');
      expect(sym).toBeDefined();
      expect(sym!.kind).toBe('function');
    });

    it('parses a .jsx file', async () => {
      const source = `function App() {
  return <div>Hello</div>;
}

export default App;`;
      // .jsx uses JavaScript grammar
      const result = await parseTypeScript(source, 'App.jsx');

      const sym = findSymbol(result, 'App');
      expect(sym).toBeDefined();
      expect(sym!.kind).toBe('function');
    });
  });

  // ── Complex File ───────────────────────────────────────────────────────

  describe('complex TypeScript file with all symbol types', () => {
    const COMPLEX_SOURCE = `
import { Pool } from 'pg';
import type { QueryResult } from 'pg';
import path from 'node:path';
import * as fs from 'node:fs';

export type UserId = string;
export type Status = 'active' | 'inactive';

export interface UserRecord {
  id: UserId;
  name: string;
  email: string;
  status: Status;
}

export interface Repository<T> {
  findById(id: string): Promise<T | null>;
  create(data: Partial<T>): Promise<T>;
}

export const DEFAULT_PAGE_SIZE = 25;
const INTERNAL_TIMEOUT = 5000;

export class UserRepository implements Repository<UserRecord> {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async findById(id: string): Promise<UserRecord | null> {
    const result = await this.pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return result.rows[0] ?? null;
  }

  async create(data: Partial<UserRecord>): Promise<UserRecord> {
    const result = await this.pool.query(
      'INSERT INTO users (name, email, status) VALUES ($1, $2, $3) RETURNING *',
      [data.name, data.email, data.status ?? 'active'],
    );
    return result.rows[0];
  }

  private buildQuery(filters: Record<string, unknown>): string {
    return Object.keys(filters).map((k, i) => \`\${k} = $\${i + 1}\`).join(' AND ');
  }
}

export async function createUserService(pool: Pool): Promise<UserRepository> {
  return new UserRepository(pool);
}

export default UserRepository;
`;

    it('extracts all symbol kinds', async () => {
      const result = await parseTypeScript(COMPLEX_SOURCE, 'user-repo.ts');

      // Type aliases
      expect(findSymbol(result, 'UserId')).toBeDefined();
      expect(findSymbol(result, 'UserId')!.kind).toBe('type');
      expect(findSymbol(result, 'Status')).toBeDefined();

      // Interfaces
      expect(findSymbol(result, 'UserRecord')).toBeDefined();
      expect(findSymbol(result, 'UserRecord')!.kind).toBe('interface');
      expect(findSymbol(result, 'Repository')).toBeDefined();

      // Constants
      expect(findSymbol(result, 'DEFAULT_PAGE_SIZE')).toBeDefined();
      expect(findSymbol(result, 'DEFAULT_PAGE_SIZE')!.exported).toBe(true);
      expect(findSymbol(result, 'INTERNAL_TIMEOUT')).toBeDefined();
      expect(findSymbol(result, 'INTERNAL_TIMEOUT')!.exported).toBe(false);

      // Class
      const classSym = findSymbol(result, 'UserRepository');
      expect(classSym).toBeDefined();
      expect(classSym!.kind).toBe('class');
      expect(classSym!.exported).toBe(true);

      // Class methods (qualified names)
      const findByIdSym = result.symbols.find(
        (s) => s.qualifiedName === 'UserRepository.findById',
      );
      expect(findByIdSym).toBeDefined();
      expect(findByIdSym!.kind).toBe('method');

      const createSym = result.symbols.find(
        (s) => s.qualifiedName === 'UserRepository.create',
      );
      expect(createSym).toBeDefined();

      const ctorSym = result.symbols.find(
        (s) => s.qualifiedName === 'UserRepository.constructor',
      );
      expect(ctorSym).toBeDefined();

      const buildQuerySym = result.symbols.find(
        (s) => s.qualifiedName === 'UserRepository.buildQuery',
      );
      expect(buildQuerySym).toBeDefined();

      // Standalone function
      const fnSym = findSymbol(result, 'createUserService');
      expect(fnSym).toBeDefined();
      expect(fnSym!.kind).toBe('function');
      expect(fnSym!.exported).toBe(true);
    });

    it('extracts all imports', async () => {
      const result = await parseTypeScript(COMPLEX_SOURCE, 'user-repo.ts');

      // Named import from 'pg'
      const pgImport = findImport(result, 'pg');
      expect(pgImport).toBeDefined();

      // Type import from 'pg' (may merge or separate)
      const allPgImports = result.imports.filter((i) => i.targetPath === 'pg');
      const allPgNames = allPgImports.flatMap((i) => i.importNames);
      expect(allPgNames).toContain('Pool');
      expect(allPgNames).toContain('QueryResult');

      // Default import
      const pathImport = findImport(result, 'node:path');
      expect(pathImport).toBeDefined();
      expect(pathImport!.isDefaultImport).toBe(true);

      // Namespace import
      const fsImport = findImport(result, 'node:fs');
      expect(fsImport).toBeDefined();
      expect(fsImport!.importNames).toContain('fs');
    });

    it('symbol count matches expected range', async () => {
      const result = await parseTypeScript(COMPLEX_SOURCE, 'user-repo.ts');

      // We expect at minimum:
      // 2 types + 2 interfaces + 2 consts + 1 class + 4 methods + 1 function = 12
      expect(result.symbols.length).toBeGreaterThanOrEqual(12);
      expect(result.imports.length).toBeGreaterThanOrEqual(4);
    });
  });

  // ── Edge Cases ─────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('returns empty result for empty source', async () => {
      const result = await parseTypeScript('', 'empty.ts');
      expect(result.symbols).toEqual([]);
      expect(result.imports).toEqual([]);
    });

    it('handles comments-only source', async () => {
      const source = `// This is a comment\n/* Block comment */`;
      const result = await parseTypeScript(source, 'comments.ts');
      expect(result.symbols).toEqual([]);
    });

    it('handles destructured exports without crashing', async () => {
      const source = `const a = 1;\nconst b = 2;\nexport { a, b };`;
      const result = await parseTypeScript(source, 'test.ts');
      // Should not throw
      expect(result).toBeDefined();
    });
  });
});
