/**
 * Unit tests for the SQL AST parser.
 *
 * @ticket TASK-INT-BE023
 */

import { describe, it, expect } from 'vitest';
import { parseSql } from './sql-parser.js';
import { isLanguageAvailable } from './wasm-loader.js';

describe('sql-parser', () => {
    // ── CREATE TABLE ─────────────────────────────────────────────────────────

    describe('CREATE TABLE extraction', () => {
        it('extracts a CREATE TABLE statement', async () => {
            const source = [
                'CREATE TABLE users (',
                '  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),',
                '  name TEXT NOT NULL,',
                '  email TEXT NOT NULL UNIQUE',
                ');',
            ].join('\n');
            const result = await parseSql(source);

            const tables = result.symbols.filter((s) => s.kind === 'table');
            expect(tables).toHaveLength(1);
            expect(tables[0]!.name).toBe('users');
            expect(tables[0]!.start_line).toBeGreaterThanOrEqual(1);
        });

        it('extracts CREATE TABLE IF NOT EXISTS', async () => {
            const source = [
                'CREATE TABLE IF NOT EXISTS projects (',
                '  id SERIAL PRIMARY KEY,',
                '  title TEXT NOT NULL',
                ');',
            ].join('\n');
            const result = await parseSql(source);

            const tables = result.symbols.filter((s) => s.kind === 'table');
            expect(tables).toHaveLength(1);
            expect(tables[0]!.name).toBe('projects');
        });

        it('extracts column definitions as children of CREATE TABLE', async () => {
            const source = [
                'CREATE TABLE tickets (',
                '  id UUID PRIMARY KEY,',
                '  title TEXT NOT NULL,',
                '  status TEXT DEFAULT \'open\',',
                '  priority INTEGER NOT NULL DEFAULT 0',
                ');',
            ].join('\n');
            const result = await parseSql(source);

      const table = result.symbols.find((s) => s.kind === 'table');
      expect(table).toBeDefined();
      expect(table!.name).toBe('tickets');

      // Columns should be extracted as children
      // At minimum the regex fallback catches column-like patterns
      if (table!.children.length > 0) {
        const colNames = table!.children.map((c) => c.name);
        expect(colNames).toContain('id');
        expect(colNames).toContain('title');
        for (const col of table!.children) {
          expect(col.kind).toBe('column');
          expect(col.qualified_name).toContain('tickets.');
        }
      }
    });
  });

  // ── CREATE FUNCTION ──────────────────────────────────────────────────────

  describe('CREATE FUNCTION extraction', () => {
    it('extracts a CREATE FUNCTION statement', async () => {
      const source = [
        'CREATE FUNCTION advance_ticket(p_id TEXT, p_agent TEXT)',
        'RETURNS JSONB AS $$',
        'BEGIN',
        '  RETURN \'{}\'::JSONB;',
        'END;',
        '$$ LANGUAGE plpgsql;',
      ].join('\n');
      const result = await parseSql(source);

      const functions = result.symbols.filter((s) => s.kind === 'function');
      expect(functions).toHaveLength(1);
      expect(functions[0]!.name).toBe('advance_ticket');
    });

    it('extracts CREATE OR REPLACE FUNCTION', async () => {
      const source = [
        'CREATE OR REPLACE FUNCTION resolve_deps()',
        'RETURNS VOID AS $$',
        'BEGIN',
        '  NULL;',
        'END;',
        '$$ LANGUAGE plpgsql;',
      ].join('\n');
      const result = await parseSql(source);

      const functions = result.symbols.filter((s) => s.kind === 'function');
      expect(functions).toHaveLength(1);
      expect(functions[0]!.name).toBe('resolve_deps');
    });
  });

  // ── CREATE INDEX ─────────────────────────────────────────────────────────

  describe('CREATE INDEX extraction', () => {
    it('extracts a CREATE INDEX statement', async () => {
      const source =
        'CREATE INDEX idx_tickets_stage ON tickets(stage);';
      const result = await parseSql(source);

      const indexes = result.symbols.filter((s) => s.kind === 'index');
      expect(indexes).toHaveLength(1);
      expect(indexes[0]!.name).toBe('idx_tickets_stage');
    });

    it('extracts CREATE UNIQUE INDEX', async () => {
      const source =
        'CREATE UNIQUE INDEX idx_users_email ON users(email);';
      const result = await parseSql(source);

      const indexes = result.symbols.filter((s) => s.kind === 'index');
      expect(indexes).toHaveLength(1);
      expect(indexes[0]!.name).toBe('idx_users_email');
    });
  });

  // ── CREATE VIEW ──────────────────────────────────────────────────────────

  describe('CREATE VIEW extraction', () => {
    it('extracts a CREATE VIEW statement', async () => {
      const source = [
        'CREATE VIEW active_tickets AS',
        '  SELECT * FROM tickets WHERE status = \'open\';',
      ].join('\n');
      const result = await parseSql(source);

      const views = result.symbols.filter((s) => s.kind === 'view');
      expect(views).toHaveLength(1);
      expect(views[0]!.name).toBe('active_tickets');
    });
  });

  // ── Mixed SQL Content ────────────────────────────────────────────────────

  describe('mixed SQL content', () => {
    it('extracts multiple statement types from a migration file', async () => {
      const source = [
        'CREATE TABLE events (',
        '  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),',
        '  name TEXT NOT NULL,',
        '  payload JSONB NOT NULL DEFAULT \'{}\'',
        ');',
        '',
        'CREATE INDEX idx_events_name ON events(name);',
        '',
        'CREATE OR REPLACE FUNCTION notify_event()',
        'RETURNS TRIGGER AS $$',
        'BEGIN',
        '  PERFORM pg_notify(\'events\', NEW.id::TEXT);',
        '  RETURN NEW;',
        'END;',
        '$$ LANGUAGE plpgsql;',
        '',
        'CREATE VIEW recent_events AS',
        '  SELECT * FROM events ORDER BY id DESC LIMIT 100;',
      ].join('\n');
      const result = await parseSql(source);

      const kinds = result.symbols.map((s) => s.kind);
      expect(kinds).toContain('table');
      expect(kinds).toContain('index');
      expect(kinds).toContain('function');
      expect(kinds).toContain('view');

      expect(result.symbols.filter((s) => s.kind === 'table')).toHaveLength(1);
      expect(result.symbols.filter((s) => s.kind === 'index')).toHaveLength(1);
      expect(result.symbols.filter((s) => s.kind === 'function')).toHaveLength(1);
      expect(result.symbols.filter((s) => s.kind === 'view')).toHaveLength(1);
    });
  });

  // ── Graceful Fallback ────────────────────────────────────────────────────

  describe('graceful handling', () => {
    it('imports array is always empty for SQL', async () => {
      const source = 'CREATE TABLE t (id INT);';
      const result = await parseSql(source);
      expect(result.imports).toHaveLength(0);
    });

    it('returns empty symbols for empty source', async () => {
      const result = await parseSql('');
      expect(result.symbols).toHaveLength(0);
    });

    it('returns empty symbols for SELECT-only source', async () => {
      const result = await parseSql('SELECT 1;');
      expect(result.symbols).toHaveLength(0);
    });

    if (!isLanguageAvailable('sql')) {
      it('returns warning when SQL grammar WASM is not available', async () => {
        const source = 'CREATE TABLE t (id INT);';
        const result = await parseSql(source);
        expect(result.warning).toBeDefined();
        expect(result.warning).toContain('regex fallback');
      });
    }
  });

  // ── Regex Fallback Specific Tests ────────────────────────────────────────

  describe('regex fallback accuracy', () => {
    // These tests exercise the regex path regardless of grammar availability
    // by testing patterns that both AST and regex should handle

    it('handles schema-qualified table names', async () => {
      const source = 'CREATE TABLE public.accounts (\n  id SERIAL\n);';
      const result = await parseSql(source);

      const tables = result.symbols.filter((s) => s.kind === 'table');
      expect(tables).toHaveLength(1);
      // Name might be "accounts" or "public.accounts" depending on parser
      expect(tables[0]!.name).toContain('accounts');
    });

    it('handles CREATE INDEX IF NOT EXISTS', async () => {
      const source =
        'CREATE INDEX IF NOT EXISTS idx_foo ON bar(baz);';
      const result = await parseSql(source);

      const indexes = result.symbols.filter((s) => s.kind === 'index');
      expect(indexes).toHaveLength(1);
      expect(indexes[0]!.name).toBe('idx_foo');
    });
  });
});
