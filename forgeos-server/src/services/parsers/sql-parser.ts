/**
 * SQL AST Parser
 *
 * Extracts symbols (CREATE TABLE, CREATE FUNCTION, CREATE INDEX, CREATE VIEW)
 * from SQL source code using web-tree-sitter with the SQL grammar.
 *
 * If the SQL grammar WASM is not available, falls back to regex-based extraction
 * and returns a warning in the result.
 *
 * @ticket TASK-INT-BE023
 */

import type Parser from 'web-tree-sitter';
import { getParser, isLanguageAvailable } from './wasm-loader.js';
import type { CodeSymbol, CodeImport, ParseResult } from './python-parser.js';

export type { CodeSymbol, CodeImport, ParseResult };

export interface SqlParseResult extends ParseResult {
  warning?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

type SyntaxNode = Parser.SyntaxNode;

/**
 * Extract an identifier name from various SQL node shapes.
 * Tries common field names and falls back to first named child.
 */
function extractName(node: SyntaxNode): string {
  const nameNode =
    node.childForFieldName('name') ??
    node.childForFieldName('table_name') ??
    node.childForFieldName('index_name') ??
    node.childForFieldName('function_name');
  if (nameNode) return nameNode.text;

  // Fallback: scan for identifier-like children
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (
      child &&
      (child.type === 'identifier' ||
        child.type === 'object_reference' ||
        child.type === 'relation_expr')
    ) {
      return child.text;
    }
  }

  return '<unknown>';
}

// ── Tree-sitter-based Extraction ─────────────────────────────────────────────

/**
 * Walk the AST for CREATE statements and extract symbols.
 */
function extractSqlSymbols(root: SyntaxNode): CodeSymbol[] {
  const symbols: CodeSymbol[] = [];
  walkNode(root, symbols);
  return symbols;
}

function walkNode(node: SyntaxNode, out: CodeSymbol[]): void {
  const type = node.type;

  if (isCreateTableLike(type)) {
    const name = extractName(node);
    const children = extractColumnSymbols(node);
    out.push({
      name,
      qualified_name: name,
      kind: 'table',
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
      signature: buildStatementSignature(node),
      exported: false,
      children,
    });
    return;
  }

  if (isCreateFunctionLike(type)) {
    const name = extractName(node);
    out.push({
      name,
      qualified_name: name,
      kind: 'function',
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
      signature: buildStatementSignature(node),
      exported: false,
      children: [],
    });
    return;
  }

  if (isCreateIndexLike(type)) {
    const name = extractName(node);
    out.push({
      name,
      qualified_name: name,
      kind: 'index',
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
      signature: buildStatementSignature(node),
      exported: false,
      children: [],
    });
    return;
  }

  if (isCreateViewLike(type)) {
    const name = extractName(node);
    out.push({
      name,
      qualified_name: name,
      kind: 'view',
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
      signature: buildStatementSignature(node),
      exported: false,
      children: [],
    });
    return;
  }

  // Recurse into children for compound statements
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) walkNode(child, out);
  }
}

function isCreateTableLike(type: string): boolean {
  return (
    type === 'create_table_statement' ||
    type === 'create_table' ||
    type.includes('create_table')
  );
}

function isCreateFunctionLike(type: string): boolean {
  return (
    type === 'create_function_statement' ||
    type === 'create_function' ||
    type.includes('create_function')
  );
}

function isCreateIndexLike(type: string): boolean {
  return (
    type === 'create_index_statement' ||
    type === 'create_index' ||
    type.includes('create_index')
  );
}

function isCreateViewLike(type: string): boolean {
  return (
    type === 'create_view_statement' ||
    type === 'create_view' ||
    type.includes('create_view')
  );
}

/**
 * Extract column definitions inside a CREATE TABLE as child symbols.
 */
function extractColumnSymbols(tableNode: SyntaxNode): CodeSymbol[] {
  const columns: CodeSymbol[] = [];
  const tableName = extractName(tableNode);

  walkForColumns(tableNode, tableName, columns);
  return columns;
}

function walkForColumns(
  node: SyntaxNode,
  tableName: string,
  out: CodeSymbol[],
): void {
  if (
    node.type === 'column_definition' ||
    node.type === 'column_def'
  ) {
    const name = extractName(node);
    out.push({
      name,
      qualified_name: `${tableName}.${name}`,
      kind: 'column',
      start_line: node.startPosition.row + 1,
      end_line: node.endPosition.row + 1,
      signature: node.text.trim(),
      exported: false,
      children: [],
    });
    return;
  }

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) walkForColumns(child, tableName, out);
  }
}

function buildStatementSignature(node: SyntaxNode): string {
  // Take the first line of the statement as a compact signature
  const firstLine = node.text.split('\n')[0] ?? '';
  return firstLine.trim();
}

// ── Regex Fallback (no grammar WASM) ─────────────────────────────────────────

const CREATE_TABLE_RE =
  /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(?:"[^"]+"|[\w.]+)\s*\.\s*)?("?[\w]+"?)\s*\(/gi;

const CREATE_FUNCTION_RE =
  /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:(?:"[^"]+"|[\w.]+)\s*\.\s*)?("?[\w]+"?)\s*\(/gi;

const CREATE_INDEX_RE =
  /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:CONCURRENTLY\s+)?("?[\w]+"?)\s+ON/gi;

const CREATE_VIEW_RE =
  /CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+(?:(?:"[^"]+"|[\w.]+)\s*\.\s*)?("?[\w]+"?)\s/gi;

const COLUMN_DEF_RE =
  /^\s+("?[\w]+"?)\s+([\w]+(?:\([\d,]+\))?)/gm;

interface RegexMatch {
  name: string;
  kind: string;
  line: number;
  signature: string;
}

function regexExtractStatements(source: string): RegexMatch[] {
  const lines = source.split('\n');
  const matches: RegexMatch[] = [];

  const patterns: Array<{ re: RegExp; kind: string }> = [
    { re: CREATE_TABLE_RE, kind: 'table' },
    { re: CREATE_FUNCTION_RE, kind: 'function' },
    { re: CREATE_INDEX_RE, kind: 'index' },
    { re: CREATE_VIEW_RE, kind: 'view' },
  ];

  for (const { re, kind } of patterns) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(source)) !== null) {
      const name = (match[1] ?? '').replace(/"/g, '');
      const offset = match.index;
      const line = source.substring(0, offset).split('\n').length;
      const sigLine = lines[line - 1] ?? '';
      matches.push({ name, kind, line, signature: sigLine.trim() });
    }
  }

  return matches;
}

function regexExtractColumns(
  source: string,
  tableName: string,
  tableStartLine: number,
): CodeSymbol[] {
  // Find the parenthesized block after the CREATE TABLE
  const tableStart = source.indexOf(tableName);
  if (tableStart === -1) return [];

  const parenStart = source.indexOf('(', tableStart);
  if (parenStart === -1) return [];

  // Find matching close paren
  let depth = 0;
  let parenEnd = -1;
  for (let i = parenStart; i < source.length; i++) {
    if (source[i] === '(') depth++;
    else if (source[i] === ')') {
      depth--;
      if (depth === 0) {
        parenEnd = i;
        break;
      }
    }
  }
  if (parenEnd === -1) return [];

  const block = source.substring(parenStart + 1, parenEnd);
  const columns: CodeSymbol[] = [];

  COLUMN_DEF_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = COLUMN_DEF_RE.exec(block)) !== null) {
    const colName = (match[1] ?? '').replace(/"/g, '');
    // Skip SQL keywords that aren't column names
    const upper = colName.toUpperCase();
    if (
      upper === 'PRIMARY' ||
      upper === 'FOREIGN' ||
      upper === 'UNIQUE' ||
      upper === 'CHECK' ||
      upper === 'CONSTRAINT' ||
      upper === 'INDEX'
    ) {
      continue;
    }
    const colLine =
      tableStartLine +
      block.substring(0, match.index).split('\n').length -
      1;
    columns.push({
      name: colName,
      qualified_name: `${tableName}.${colName}`,
      kind: 'column',
      start_line: colLine,
      end_line: colLine,
      signature: match[0].trim(),
      exported: false,
      children: [],
    });
  }

  return columns;
}

function regexFallback(source: string): CodeSymbol[] {
  const statements = regexExtractStatements(source);
  const symbols: CodeSymbol[] = [];

  for (const stmt of statements) {
    const children =
      stmt.kind === 'table'
        ? regexExtractColumns(source, stmt.name, stmt.line)
        : [];

    symbols.push({
      name: stmt.name,
      qualified_name: stmt.name,
      kind: stmt.kind,
      start_line: stmt.line,
      end_line: stmt.line,
      signature: stmt.signature,
      exported: false,
      children,
    });
  }

  return symbols;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse SQL source code and extract symbols.
 *
 * Uses tree-sitter when the SQL grammar WASM is available; otherwise
 * falls back to regex-based extraction with a warning.
 *
 * SQL files typically have no imports, so imports is always empty.
 *
 * @param source - Raw SQL source code string.
 * @returns SqlParseResult with symbols (and optional warning).
 */
export async function parseSql(source: string): Promise<SqlParseResult> {
  // SQL files have no import statements
  const imports: CodeImport[] = [];

  if (!isLanguageAvailable('sql')) {
    const symbols = regexFallback(source);
    return {
      symbols,
      imports,
      warning:
        'SQL grammar WASM not available. Results produced via regex fallback ' +
        'and may be incomplete. Run `npm run grammars:setup` to download grammar files.',
    };
  }

  const parser = await getParser('sql');
  const tree = parser.parse(source);

  try {
    const symbols = extractSqlSymbols(tree.rootNode);
    return { symbols, imports };
  } finally {
    tree.delete();
  }
}
