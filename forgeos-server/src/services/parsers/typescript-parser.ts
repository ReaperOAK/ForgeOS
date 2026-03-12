/**
 * TypeScript/JavaScript AST Parser using web-tree-sitter.
 *
 * Extracts symbols (functions, classes, methods, interfaces, type aliases,
 * constants, enums) and imports from TypeScript and JavaScript source files.
 * Output conforms to the `code_symbols` and `code_imports` table schemas
 * defined in migration 003-code-graph.sql.
 *
 * @ticket TASK-INT-BE022
 */

import type Parser from 'web-tree-sitter';
import { getParser } from './wasm-loader.js';

// ── Public Types ─────────────────────────────────────────────────────────────

export interface CodeSymbol {
    name: string;
    qualifiedName: string;
    kind: 'function' | 'class' | 'method' | 'interface' | 'type' | 'variable';
    startLine: number;
    endLine: number;
    signature: string;
    exported: boolean;
}

export interface CodeImport {
    targetPath: string;
    importNames: string[];
    isDefaultImport: boolean;
}

export interface ParseResult {
    symbols: CodeSymbol[];
    imports: CodeImport[];
}

// ── Grammar Selection ────────────────────────────────────────────────────────

function resolveGrammar(filePath: string): string {
    const lower = filePath.toLowerCase();
    if (lower.endsWith('.tsx')) return 'typescript';
    if (lower.endsWith('.ts')) return 'typescript';
    if (lower.endsWith('.jsx')) return 'javascript';
    if (lower.endsWith('.js')) return 'javascript';
    if (lower.endsWith('.mjs')) return 'javascript';
    if (lower.endsWith('.cjs')) return 'javascript';
    return 'typescript';
}

// ── Node Helpers ─────────────────────────────────────────────────────────────

function nodeText(node: Parser.SyntaxNode | null): string {
    return node?.text ?? '';
}

function childByField(node: Parser.SyntaxNode, field: string): Parser.SyntaxNode | null {
  return node.childForFieldName(field);
}

/**
 * Extract the first line of a node's text as a compact signature.
 */
function extractSignature(node: Parser.SyntaxNode): string {
  const firstLine = node.text.split('\n')[0]?.trim() ?? '';
  // Trim trailing '{' for readability
  return firstLine.replace(/\s*\{?\s*$/, '').trim();
}

/**
 * Check whether a node is wrapped in an export_statement ancestor.
 */
function isExported(node: Parser.SyntaxNode): boolean {
  const parent = node.parent;
  if (!parent) return false;
  return parent.type === 'export_statement';
}

/**
 * Resolve the name node from a declaration that may sit inside an export_statement.
 */
function declarationNameText(node: Parser.SyntaxNode, field: string): string {
  return nodeText(childByField(node, field));
}

// ── Symbol Extraction ────────────────────────────────────────────────────────

function extractFunction(
  node: Parser.SyntaxNode,
  _parentQualified?: string,
): CodeSymbol | null {
  const name = declarationNameText(node, 'name');
  if (!name) return null;
  return {
    name,
    qualifiedName: _parentQualified ? `${_parentQualified}.${name}` : name,
    kind: 'function',
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    signature: extractSignature(node),
    exported: isExported(node),
  };
}

function extractClass(node: Parser.SyntaxNode): CodeSymbol {
  const name = declarationNameText(node, 'name') || 'default';
  return {
    name,
    qualifiedName: name,
    kind: 'class',
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    signature: extractSignature(node),
    exported: isExported(node),
  };
}

function extractMethod(
  node: Parser.SyntaxNode,
  parentQualified: string,
): CodeSymbol | null {
  const nameNode = childByField(node, 'name');
  const name = nodeText(nameNode);
  if (!name) return null;
  return {
    name,
    qualifiedName: `${parentQualified}.${name}`,
    kind: 'method',
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    signature: extractSignature(node),
    exported: false,
  };
}

function extractInterface(node: Parser.SyntaxNode): CodeSymbol | null {
  const name = declarationNameText(node, 'name');
  if (!name) return null;
  return {
    name,
    qualifiedName: name,
    kind: 'interface',
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    signature: extractSignature(node),
    exported: isExported(node),
  };
}

function extractTypeAlias(node: Parser.SyntaxNode): CodeSymbol | null {
  const name = declarationNameText(node, 'name');
  if (!name) return null;
  return {
    name,
    qualifiedName: name,
    kind: 'type',
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    signature: extractSignature(node),
    exported: isExported(node),
  };
}

function extractVariableDeclaration(
  node: Parser.SyntaxNode,
  exported: boolean,
): CodeSymbol[] {
  const symbols: CodeSymbol[] = [];
  for (const child of node.children) {
    if (child.type === 'variable_declarator') {
      const nameNode = childByField(child, 'name');
      const name = nodeText(nameNode);
      if (!name) continue;
      symbols.push({
        name,
        qualifiedName: name,
        kind: 'variable',
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        signature: extractSignature(node),
        exported,
      });
    }
  }
  return symbols;
}

function extractEnum(node: Parser.SyntaxNode): CodeSymbol | null {
  const name = declarationNameText(node, 'name');
  if (!name) return null;
  return {
    name,
    qualifiedName: name,
    kind: 'variable',
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    signature: extractSignature(node),
    exported: isExported(node),
  };
}

// ── Import / Re-export Extraction ────────────────────────────────────────────

function extractImportSource(node: Parser.SyntaxNode): string {
  const sourceNode = childByField(node, 'source');
  if (!sourceNode) return '';
  // Strip surrounding quotes
  return sourceNode.text.replace(/^['"]|['"]$/g, '');
}

function extractImportStatement(node: Parser.SyntaxNode): CodeImport[] {
  const targetPath = extractImportSource(node);
  if (!targetPath) return [];

  const results: CodeImport[] = [];

  for (const child of node.children) {
    switch (child.type) {
      // `import Foo from '...'`
      case 'identifier': {
        results.push({
          targetPath,
          importNames: [child.text],
          isDefaultImport: true,
        });
        break;
      }
      // `import { a, b } from '...'`
      case 'named_imports': {
        const names: string[] = [];
        for (const spec of child.children) {
          if (spec.type === 'import_specifier') {
            const nameNode = childByField(spec, 'name');
            names.push(nodeText(nameNode || spec));
          }
        }
        if (names.length > 0) {
          results.push({ targetPath, importNames: names, isDefaultImport: false });
        }
        break;
      }
      // `import * as ns from '...'`
      case 'namespace_import': {
        const aliasText = child.text.replace(/^\*\s*as\s*/, '').trim();
        results.push({
          targetPath,
          importNames: [aliasText],
          isDefaultImport: false,
        });
        break;
      }
      // `import type { ... } from '...'` — import_clause wraps the inner
      case 'import_clause': {
        for (const inner of child.children) {
          if (inner.type === 'identifier') {
            results.push({
              targetPath,
              importNames: [inner.text],
              isDefaultImport: true,
            });
          } else if (inner.type === 'named_imports') {
            const names: string[] = [];
            for (const spec of inner.children) {
              if (spec.type === 'import_specifier') {
                const nameNode = childByField(spec, 'name');
                names.push(nodeText(nameNode || spec));
              }
            }
            if (names.length > 0) {
              results.push({ targetPath, importNames: names, isDefaultImport: false });
            }
          } else if (inner.type === 'namespace_import') {
            const aliasText = inner.text.replace(/^\*\s*as\s*/, '').trim();
            results.push({
              targetPath,
              importNames: [aliasText],
              isDefaultImport: false,
            });
          }
        }
        break;
      }
    }
  }

  // Fallback: if we found no specifiers but have a source, record it as side-effect import
  if (results.length === 0) {
    results.push({ targetPath, importNames: [], isDefaultImport: false });
  }

  return results;
}

function extractReExport(node: Parser.SyntaxNode): CodeImport[] {
  const targetPath = extractImportSource(node);
  if (!targetPath) return [];

  const names: string[] = [];
  for (const child of node.children) {
    if (child.type === 'export_clause') {
      for (const spec of child.children) {
        if (spec.type === 'export_specifier') {
          const nameNode = childByField(spec, 'name');
          names.push(nodeText(nameNode || spec));
        }
      }
    }
  }

  if (names.length > 0) {
    return [{ targetPath, importNames: names, isDefaultImport: false }];
  }
  // `export * from '...'`
  return [{ targetPath, importNames: ['*'], isDefaultImport: false }];
}

// ── AST Visitor ──────────────────────────────────────────────────────────────

function visitClassBody(
  body: Parser.SyntaxNode,
  className: string,
  symbols: CodeSymbol[],
): void {
  for (const member of body.children) {
    switch (member.type) {
      case 'method_definition': {
        const methodSym = extractMethod(member, className);
        if (methodSym) symbols.push(methodSym);
        break;
      }
      case 'public_field_definition':
        // Properties are tracked as part of the class, not as separate symbols
        break;
    }
  }
}

function visit(
  node: Parser.SyntaxNode,
  symbols: CodeSymbol[],
  imports: CodeImport[],
): void {
  switch (node.type) {
    case 'function_declaration': {
      const sym = extractFunction(node);
      if (sym) symbols.push(sym);
      return; // Don't recurse into function body
    }

    case 'class_declaration': {
      const classSym = extractClass(node);
      symbols.push(classSym);
      // Visit class body for methods
      const classBody = childByField(node, 'body');
      if (classBody) {
        visitClassBody(classBody, classSym.name, symbols);
      }
      return; // Don't recurse further
    }

    case 'interface_declaration': {
      const sym = extractInterface(node);
      if (sym) symbols.push(sym);
      return;
    }

    case 'type_alias_declaration': {
      const sym = extractTypeAlias(node);
      if (sym) symbols.push(sym);
      return;
    }

    case 'lexical_declaration':
    case 'variable_declaration': {
      const exported = isExported(node);
      const variableSyms = extractVariableDeclaration(node, exported);
      symbols.push(...variableSyms);
      return;
    }

    case 'enum_declaration': {
      const sym = extractEnum(node);
      if (sym) symbols.push(sym);
      return;
    }

    case 'import_statement': {
      const importResults = extractImportStatement(node);
      imports.push(...importResults);
      return;
    }

    case 'export_statement': {
      // Re-exports: `export { x } from './foo'`
      const source = childByField(node, 'source');
      if (source) {
        const reExports = extractReExport(node);
        imports.push(...reExports);
        return;
      }
      // `export default function/class` or `export function/class`
      // Recurse into the child declaration — the child will detect export via parent
      for (const child of node.children) {
        visit(child, symbols, imports);
      }
      return;
    }
  }

  // Recurse children for container nodes (program, etc.)
  for (const child of node.children) {
    visit(child, symbols, imports);
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse TypeScript or JavaScript source code and extract symbols and imports.
 *
 * @param source - The source code string.
 * @param filePath - The file path (used to select the grammar).
 * @returns Extracted symbols and imports conforming to the DB schema.
 */
export async function parseTypeScript(
  source: string,
  filePath: string,
): Promise<ParseResult> {
  const grammar = resolveGrammar(filePath);
  const parser = await getParser(grammar);
  const tree = parser.parse(source);

  const symbols: CodeSymbol[] = [];
  const imports: CodeImport[] = [];

  visit(tree.rootNode, symbols, imports);

  tree.delete();

  return { symbols, imports };
}
