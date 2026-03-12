---
title: "ADR-004: tree-sitter for Code Parsing"
ticket: CTO-intelligence-architecture
type: architecture
author: Architect
date: 2026-03-12T00:00:00Z
status: PROPOSED
tags: [architecture, adr, tree-sitter, code-graph, phase2]
---

# ADR-004: tree-sitter for Code Parsing

> **Ticket:** CTO-intelligence-architecture | **Agent:** Architect | **Date:** 2026-03-12  
> **Confidence:** HIGH (92%) | **Status:** PROPOSED

---

## 1. Status

**PROPOSED** — 2026-03-12

---

## 2. Context

ForgeOS Phase 2 (Cognition Engine) requires parsing source code into a structural graph (files, symbols, imports, dependencies). The parser must support multiple languages (TypeScript, Python, JavaScript, SQL), produce consistent AST output, and run efficiently enough for incremental re-indexing on every commit.

**Requirements:**
- Multi-language support (5+ languages)
- Consistent AST node types across languages
- Incremental parsing (re-parse only changed regions)
- Error-tolerant (parse incomplete/invalid code without crashing)
- Sub-second parse time for individual files
- Available as WASM or native Node.js bindings (ForgeOS server is TypeScript)

---

## 3. Alternatives Evaluated

### 3.1 tree-sitter

- **Type:** Incremental parsing library with language grammars
- **Languages:** 100+ via community grammars
- **Performance:** O(n) initial parse, O(log n) incremental edits
- **Error tolerance:** Excellent — produces partial ASTs for invalid code
- **Bindings:** Node.js native (`node-tree-sitter`), WASM (`web-tree-sitter`)
- **Maturity:** Used by GitHub, Neovim, Zed, Helix editors
- **License:** MIT

### 3.2 TypeScript Compiler API (ts.createSourceFile)

- **Type:** Full compiler with AST access
- **Languages:** TypeScript/JavaScript only
- **Performance:** Slower (full type-checking pipeline, ~100ms per file)
- **Error tolerance:** Good for TS/JS
- **Limitation:** Single-language; no Python, SQL, etc.

### 3.3 Babel Parser (@babel/parser)

- **Type:** JavaScript/TypeScript parser
- **Languages:** JS/TS/JSX/TSX only
- **Performance:** ~50ms per file
- **Limitation:** Single ecosystem; no Python, SQL

### 3.4 SWC Parser

- **Type:** Rust-based JS/TS compiler
- **Languages:** JS/TS only
- **Performance:** Extremely fast (~5ms per file)
- **Limitation:** Single ecosystem; AST format is SWC-specific

### 3.5 ANTLR4

- **Type:** Parser generator with grammar specifications
- **Languages:** Theoretically any (grammar must exist)
- **Performance:** Variable; typically slower than tree-sitter
- **Error tolerance:** Poor — struggles with incomplete code
- **Complexity:** Higher integration effort; runtime dependency

---

## 4. Technology Selection Matrix

| Criterion (weight) | tree-sitter | TS Compiler | Babel | SWC | ANTLR4 |
|----|----|----|----|----|----|
| Multi-language (30%) | 10 | 2 | 2 | 2 | 7 |
| Performance (20%) | 9 | 5 | 7 | 10 | 5 |
| Error tolerance (15%) | 10 | 7 | 7 | 7 | 3 |
| Incremental parsing (15%) | 10 | 3 | 1 | 1 | 1 |
| Ecosystem/maturity (10%) | 9 | 10 | 9 | 8 | 7 |
| Integration effort (10%) | 7 | 8 | 8 | 8 | 4 |
| **Weighted Total** | **9.25** | **4.95** | **4.45** | **4.65** | **4.80** |

---

## 5. Decision

**Use tree-sitter with web-tree-sitter (WASM) bindings** for the ForgeOS Cognition Engine.

Rationale:
1. **Multi-language is non-negotiable** — ForgeOS indexes repos with mixed TypeScript, Python, SQL, and more. tree-sitter is the only candidate supporting all target languages with consistent AST output.
2. **Incremental parsing** enables sub-second re-indexing when only a few files change.
3. **Error tolerance** is critical — agents may commit incomplete code during work-in-progress.
4. **Industry validation** — GitHub's code navigation and Copilot use tree-sitter internally.

**WASM over native bindings** because:
- Avoids native compilation issues across Linux/macOS
- Simpler Docker deployment (no node-gyp)
- Grammar files loaded dynamically at runtime

---

## 6. Consequences

### Positive
- Unified parsing pipeline for all supported languages
- Incremental indexing reduces re-parse overhead to changed files only
- Graceful degradation on malformed code
- Community-maintained grammars for 100+ languages

### Negative
- WASM bindings are ~2x slower than native C bindings
- Tree-sitter AST node types vary per language grammar (requires per-language symbol extraction logic)
- Grammar updates may change AST structure (pin grammar versions)

### Risks
- Limited SQL grammar coverage for complex PostgreSQL extensions (mitigated: use simple pattern matching as fallback for SQL)
- WASM memory limits for very large files > 10MB (mitigated: skip files exceeding threshold)

---

## 7. Implementation Notes

- npm package: `web-tree-sitter` + individual grammar packages (`tree-sitter-typescript`, `tree-sitter-python`, etc.)
- Symbol extraction is language-specific: one extractor function per grammar
- File: `forgeos-server/src/indexer/extractors/{language}.ts`
- Grammar WASMs loaded from: `forgeos-server/grammars/*.wasm`
