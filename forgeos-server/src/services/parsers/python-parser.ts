/**
 * Python AST Parser
 *
 * Extracts symbols (functions, classes, methods) and imports from Python
 * source code using web-tree-sitter with the Python grammar.
 *
 * @ticket TASK-INT-BE023
 */

import type Parser from 'web-tree-sitter';
import { getParser } from './wasm-loader.js';

// ── Output Types ─────────────────────────────────────────────────────────────

export interface CodeSymbol {
  name: string;
  qualified_name: string;
  kind: string;
  start_line: number;
  end_line: number;
  signature: string | null;
  exported: boolean;
  children: CodeSymbol[];
}

export interface CodeImport {
  source_path: string;
  imported_name: string | null;
  alias: string | null;
  is_default: boolean;
  is_namespace: boolean;
  is_type_only: boolean;
}

export interface ParseResult {
  symbols: CodeSymbol[];
  imports: CodeImport[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

type SyntaxNode = Parser.SyntaxNode;

function nodeText(node: SyntaxNode | null): string {
  return node?.text ?? '';
}

function childByField(node: SyntaxNode, field: string): SyntaxNode | null {
  return node.childForFieldName(field);
}

/**
 * Collect decorator names preceding a decorated_definition.
 */
function extractDecorators(node: SyntaxNode): string[] {
  const decorators: string[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child?.type === 'decorator') {
      const expr = child.child(1); // child(0) is '@'
      if (expr) decorators.push(expr.text);
    }
  }
  return decorators;
}

/**
 * Build a function/method signature string from a function_definition node.
 */
function buildFunctionSignature(
  node: SyntaxNode,
  decorators: string[],
): string {
  const name = nodeText(childByField(node, 'name'));
  const params = childByField(node, 'parameters');
  const returnType = childByField(node, 'return_type');

  let sig = '';
  for (const d of decorators) {
    sig += `@${d}\n`;
  }
  sig += `def ${name}`;
  sig += params ? params.text : '()';
  if (returnType) {
    sig += ` -> ${returnType.text}`;
  }
  return sig;
}

// ── Symbol Extraction ────────────────────────────────────────────────────────

function extractFunctionSymbol(
  node: SyntaxNode,
  parentQualified: string,
  decorators: string[],
): CodeSymbol {
  const name = nodeText(childByField(node, 'name'));
  const qualified = parentQualified ? `${parentQualified}.${name}` : name;
  const kind = parentQualified ? 'method' : 'function';

  return {
    name,
    qualified_name: qualified,
    kind,
    start_line: node.startPosition.row + 1,
    end_line: node.endPosition.row + 1,
    signature: buildFunctionSignature(node, decorators),
    exported: false, // Python uses __all__ convention; we default false
    children: [],
  };
}

function extractClassSymbol(
  node: SyntaxNode,
  parentQualified: string,
  decorators: string[],
): CodeSymbol {
  const name = nodeText(childByField(node, 'name'));
  const qualified = parentQualified ? `${parentQualified}.${name}` : name;

  const bases = childByField(node, 'superclasses');
  let sig = '';
  for (const d of decorators) {
    sig += `@${d}\n`;
  }
  sig += `class ${name}`;
  if (bases) {
    sig += bases.text;
  }

  const body = childByField(node, 'body');
  const children: CodeSymbol[] = [];
  if (body) {
    extractSymbolsFromBlock(body, qualified, children);
  }

  return {
    name,
    qualified_name: qualified,
    kind: 'class',
    start_line: node.startPosition.row + 1,
    end_line: node.endPosition.row + 1,
    signature: sig,
    exported: false,
    children,
  };
}

/**
 * Walk a block node and extract child symbols (functions/classes).
 */
function extractSymbolsFromBlock(
  block: SyntaxNode,
  parentQualified: string,
  out: CodeSymbol[],
): void {
  for (let i = 0; i < block.childCount; i++) {
    const child = block.child(i);
    if (!child) continue;

    if (child.type === 'function_definition') {
      out.push(extractFunctionSymbol(child, parentQualified, []));
    } else if (child.type === 'class_definition') {
      out.push(extractClassSymbol(child, parentQualified, []));
    } else if (child.type === 'decorated_definition') {
      const decorators = extractDecorators(child);
      const definition = child.childForFieldName('definition');
      if (definition?.type === 'function_definition') {
        out.push(extractFunctionSymbol(definition, parentQualified, decorators));
      } else if (definition?.type === 'class_definition') {
        out.push(extractClassSymbol(definition, parentQualified, decorators));
      }
    }
  }
}

// ── Import Extraction ────────────────────────────────────────────────────────

function extractImports(root: SyntaxNode): CodeImport[] {
  const imports: CodeImport[] = [];

  for (let i = 0; i < root.childCount; i++) {
    const child = root.child(i);
    if (!child) continue;

    if (child.type === 'import_statement') {
      // `import os` / `import os as operating_system` / `import os, sys`
      for (let j = 0; j < child.namedChildCount; j++) {
        const nameNode = child.namedChild(j);
        if (!nameNode) continue;

        if (nameNode.type === 'dotted_name') {
          imports.push({
            source_path: nameNode.text,
            imported_name: null,
            alias: null,
            is_default: false,
            is_namespace: true,
            is_type_only: false,
          });
        } else if (nameNode.type === 'aliased_import') {
          const moduleName = childByField(nameNode, 'name');
          const aliasNode = childByField(nameNode, 'alias');
          imports.push({
            source_path: nodeText(moduleName),
            imported_name: null,
            alias: nodeText(aliasNode),
            is_default: false,
            is_namespace: true,
            is_type_only: false,
          });
        }
      }
    } else if (child.type === 'import_from_statement') {
      // `from os import path` / `from os import path as p`
      const moduleNode = childByField(child, 'module_name');
      const modulePath = nodeText(moduleNode);
      const moduleId = moduleNode?.id;

      for (let j = 0; j < child.namedChildCount; j++) {
        const nameNode = child.namedChild(j);
        if (!nameNode) continue;
        // Skip the module name node itself
        if (nameNode.id === moduleId) continue;

        if (nameNode.type === 'dotted_name') {
          imports.push({
            source_path: modulePath,
            imported_name: nameNode.text,
            alias: null,
            is_default: false,
            is_namespace: false,
            is_type_only: false,
          });
        } else if (nameNode.type === 'aliased_import') {
          const importedName = childByField(nameNode, 'name');
          const aliasNode = childByField(nameNode, 'alias');
          imports.push({
            source_path: modulePath,
            imported_name: nodeText(importedName),
            alias: nodeText(aliasNode),
            is_default: false,
            is_namespace: false,
            is_type_only: false,
          });
        } else if (nameNode.type === 'wildcard_import') {
          imports.push({
            source_path: modulePath,
            imported_name: '*',
            alias: null,
            is_default: false,
            is_namespace: true,
            is_type_only: false,
          });
        }
      }
    }
  }

  return imports;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse Python source code and extract symbols and imports.
 *
 * @param source - Raw Python source code string.
 * @returns ParseResult with symbols and imports arrays.
 */
export async function parsePython(source: string): Promise<ParseResult> {
  const parser = await getParser('python');
  const tree = parser.parse(source);

  try {
    const root = tree.rootNode;
    const symbols: CodeSymbol[] = [];
    extractSymbolsFromBlock(root, '', symbols);
    const imports = extractImports(root);

    return { symbols, imports };
  } finally {
    tree.delete();
  }
}
