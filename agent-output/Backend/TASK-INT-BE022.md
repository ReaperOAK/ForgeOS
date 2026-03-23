# TASK-INT-BE022 — TypeScript and JavaScript AST Parser

## Stage: BACKEND Complete

### Artifacts
- `forgeos-server/src/services/parsers/typescript-parser.ts` (NEW — 320 lines)
- `forgeos-server/src/services/parsers/typescript-parser.test.ts` (NEW — 29 tests)

### Summary
Implemented the TypeScript/JavaScript AST parser using `web-tree-sitter` via the grammar loader from TASK-INT-DO001. The parser extracts symbols and imports from TypeScript (.ts/.tsx) and JavaScript (.js/.jsx/.mjs/.cjs) source files, outputting data conforming to the `code_symbols` and `code_imports` DB schemas from migration 003.

### TDD Evidence
- **RED**: Created 29 tests covering all acceptance criteria before implementation
- **GREEN**: Implemented parser — all 29 tests pass
- **REFACTOR**: Fixed strict null check (`noUncheckedIndexedAccess`) in `extractSignature`

### Implementation Details

**Symbols extracted:**
| Kind | AST Node Types |
|------|---------------|
| `function` | `function_declaration` |
| `class` | `class_declaration` |
| `method` | `method_definition` (with qualified names: `ClassName.methodName`) |
| `interface` | `interface_declaration` |
| `type` | `type_alias_declaration` |
| `variable` | `lexical_declaration`, `variable_declaration`, `enum_declaration` |

**Imports extracted:**
- Named imports: `import { foo, bar } from '...'`
- Default imports: `import Foo from '...'`
- Namespace imports: `import * as ns from '...'`
- Type-only imports: `import type { T } from '...'`
- Mixed imports: `import Default, { named } from '...'`
- Re-exports: `export { x } from '...'`

**Architecture:**
- Pure functions with no side effects (except parser initialization)
- Grammar selection via file extension
- Recursive AST visitor with early returns for leaf nodes
- Export detection via parent node inspection

### Test Coverage
- 29 tests covering:
  - Function declarations (simple, exported, async)
  - Arrow functions as const
  - Class declarations with methods and qualified names
  - Interface and type alias declarations
  - All import variants (named, default, namespace, mixed, type-only)
  - Export statements (inline, default, re-exports)
  - Variable/constant declarations
  - Enum declarations
  - JavaScript file parsing (.js, .jsx)
  - Complex file with all symbol types combined
  - Edge cases (empty source, comments-only, destructured exports)

### Acceptance Criteria Verification
- [x] AC1: Uses `web-tree-sitter` via `getParser()` from DO001 wasm-loader
- [x] AC2: Extracts function declarations with name, lines, signature, exported flag
- [x] AC3: Extracts class declarations with nested methods using qualified names
- [x] AC4: Extracts interface and type alias declarations
- [x] AC5: Extracts import statements (named, default, namespace)
- [x] AC6: Extracts export statements (named, default, re-exports)
- [x] AC7: Output format matches `{ symbols: CodeSymbol[], imports: CodeImport[] }` per DB schema
- [x] AC8: Unit test parsing complex TypeScript file with all symbol types

### Confidence: HIGH
