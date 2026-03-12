# Intelligence Features Setup Guide

> **Category:** How-To  
> **Audience:** DevOps engineers, platform operators  
> **Last Reviewed:** 2026-03-13

This guide covers installation and configuration of the ForgeOS Intelligence
Evolution features: Code Graph Engine (Phase 2), Memory Engine (Phase 3), and
Drop-In Initialization (Phase 4).

---

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| PostgreSQL | 14+ | Existing ForgeOS database |
| pgvector | 0.7+ | Required for semantic search |
| Node.js | 22+ | For the MCP Server |
| OpenAI API key | — | For embedding generation (`text-embedding-3-small`) |

---

## 1. Install pgvector

### Docker (recommended)

The ForgeOS Docker Compose stack uses `pgvector/pgvector:pg17`, which includes
pgvector pre-installed. No extra steps are needed if you run the standard stack:

```bash
make up
```

### Manual installation

If you run PostgreSQL outside Docker, install pgvector from source:

```bash
cd /tmp
git clone --branch v0.7.4 https://github.com/pgvector/pgvector.git
cd pgvector
make
make install
```

Then enable the extension in your database:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

---

## 2. Configure the OpenAI API key

The Memory Engine uses OpenAI `text-embedding-3-small` (1536 dimensions) to
generate embeddings for lessons and code symbols. Set the API key as an
environment variable.

### Docker

Add the key to your `.env` file (created by `make setup`):

```bash
OPENAI_API_KEY=sk-...your-key-here
```

The Docker Compose stack passes this variable to the MCP Server container
automatically.

### Local development

Export the variable in your shell:

```bash
export OPENAI_API_KEY=sk-...your-key-here
```

> **Security note:** Never commit API keys to version control. The `.env`
> file is listed in `.gitignore`.

---

## 3. Run database migrations

Migrations must be applied in order. The MCP Server applies pending
migrations on startup, or you can run them manually.

### Automatic (on server start)

```bash
make up
```

The MCP Server checks for pending migrations in
`forgeos-server/src/db/migrations/` and applies them sequentially.

### Manual

```bash
cd forgeos-server
npx ts-node src/db/migrate.ts
```

### Migration order

| Migration | Purpose |
|-----------|---------|
| `001_initial.sql` | Core schema (tickets, events, agents) |
| `002_*.sql` | MCP cutover extensions |
| `003-code-graph.sql` | Code graph tables (`code_files`, `code_symbols`, `code_imports`, `code_edges`) and stored functions (`blast_radius`, `search_symbols`, `get_import_chain`) |
| `004-pgvector.sql` | Enables pgvector extension, creates `code_embeddings` table with HNSW index |
| `005-memory-engine.sql` | Memory tables (`lessons`, `lesson_embeddings`) and stored function (`search_similar_lessons`) |

### Verify migrations

After applying, confirm all tables exist:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'code_files', 'code_symbols', 'code_imports', 'code_edges',
    'code_embeddings', 'lessons', 'lesson_embeddings'
  )
ORDER BY table_name;
```

Expected result: 7 rows.

Confirm stored functions exist:

```sql
SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'blast_radius', 'search_symbols',
    'get_import_chain', 'search_similar_lessons'
  );
```

Expected result: 4 rows.

---

## 4. Index the codebase

Use the `init.index` MCP tool to parse and index the project source files.
This populates the code graph tables using tree-sitter WASM parsers.

### Supported languages

| Language | Parser |
|----------|--------|
| TypeScript | tree-sitter-typescript (WASM) |
| JavaScript | tree-sitter-javascript (WASM) |
| Python | tree-sitter-python (WASM) |
| SQL | tree-sitter-sql (WASM) |
| Other | Regex fallback (limited symbol extraction) |

### Run indexing via MCP tool call

```jsonc
{
  "tool": "init.index",
  "input": {
    "root_path": "/path/to/your/project",
    "force": false  // set true to re-index all files
  }
}
```

### What indexing produces

| Output | Description |
|--------|-------------|
| `code_files` rows | One row per source file with language, line count, content hash |
| `code_symbols` rows | Functions, classes, methods, interfaces, types, variables |
| `code_imports` rows | Import relationships between files |
| `code_edges` rows | Symbol-level dependency edges |

### Incremental indexing

By default, `init.index` skips files whose content hash has not changed
since the last index. Set `force: true` to re-index everything.

---

## 5. Orient a new project

Use the `init.orient` MCP tool to auto-discover the project's tech stack,
frameworks, and entry points.

```jsonc
{
  "tool": "init.orient",
  "input": {
    "root_path": "/path/to/your/project"
  }
}
```

The tool returns:

```jsonc
{
  "project_name": "ForgeOS",
  "package_manager": "npm",
  "frameworks": ["express", "next.js"],
  "languages": ["typescript", "python", "sql"],
  "entry_points": ["forgeos-server/src/server.ts"],
  "test_framework": "vitest",
  "build_system": "make",
  "key_directories": ["forgeos-server/src/", "dashboard/src/"],
  "config_files": ["tsconfig.json", "package.json", "Makefile"]
}
```

---

## 6. Verify Intelligence tools

After setup, verify the 8 new MCP tools are available:

| Tool | Phase | Verification |
|------|-------|-------------|
| `code.blast_radius` | 2 | Call with a known file path; expect affected files list |
| `code.search_symbols` | 2 | Search for `%Handler%`; expect symbol matches |
| `code.get_imports` | 2 | Call with a source file; expect import chain |
| `memory.add_lesson` | 3 | Add a test lesson; expect `{ lesson_id, embedded: true }` |
| `memory.search_lessons` | 3 | Search for the test lesson; expect a match |
| `memory.get_context` | 3 | Request context for a ticket; expect aggregated lessons |
| `init.index` | 4 | Index a small directory; expect file and symbol counts |
| `init.orient` | 4 | Orient the project; expect framework detection |

---

## 7. Troubleshooting

### pgvector extension not found

```
ERROR: could not open extension control file "/usr/share/postgresql/17/extension/vector.control"
```

**Cause:** pgvector is not installed in the PostgreSQL instance.

**Fix:** Use the `pgvector/pgvector:pg17` Docker image, or install pgvector
from source (see Section 1).

### Embedding generation fails

```
ERROR: OPENAI_API_KEY is not set
```

**Cause:** The `OPENAI_API_KEY` environment variable is missing.

**Fix:** Add the key to `.env` or export it in your shell (see Section 2).
Lessons can still be stored without embeddings, but semantic search returns
no results.

### HNSW index not used

If `EXPLAIN ANALYZE` shows a sequential scan instead of an index scan on
`lesson_embeddings` or `code_embeddings`:

**Cause:** PostgreSQL query planner chose a sequential scan for small tables.

**Fix:** This is normal for tables with fewer than ~1,000 rows. The HNSW index
activates automatically as the table grows. You can force it for testing:

```sql
SET enable_seqscan = off;
```

### Indexing skips all files

If `init.index` returns `{ indexed: 0, skipped: N }`:

**Cause:** All files have unchanged content hashes from a previous index.

**Fix:** Use `force: true` to re-index:

```jsonc
{ "tool": "init.index", "input": { "root_path": "/path", "force": true } }
```

---

## 8. Performance tuning

### HNSW index parameters

The default HNSW index uses `m=16, ef_construction=200`. For production
workloads with >100K embeddings, consider tuning:

```sql
-- Increase search accuracy at the cost of query time
SET hnsw.ef_search = 100;  -- default is 40
```

### Blast radius query depth

The `blast_radius` stored function uses a recursive CTE with a depth limit.
For large codebases (>10K files), keep `max_depth` at 5 or lower to maintain
sub-200ms query times.

### Connection pooling

PgBouncer is included in the Docker Compose stack for connection pooling.
The HNSW index search and recursive CTE queries benefit from persistent
connections. No additional configuration is required with the default stack.
