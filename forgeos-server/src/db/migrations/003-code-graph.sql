-- =============================================================================
-- Migration 003-code-graph.sql — Code Graph Engine Schema
-- =============================================================================
--
-- Ticket:   TASK-INT-BE019
-- Purpose:  Create the code graph schema for blast radius computation.
--           Four tables model the source code dependency graph:
--             code_files   — indexed source files with content hashes
--             code_symbols — AST-extracted symbols (functions, classes, methods)
--             code_imports — file-level import relationships
--             code_edges   — symbol-level call/reference/extension edges
--
-- Design:   The schema supports recursive CTE traversal for computing blast
--           radius (transitive closure of affected symbols given a file change).
--           UUID PKs, TIMESTAMPTZ timestamps, and CASCADE deletes follow the
--           conventions established in 001_initial.sql.
--
-- Prerequisites: PostgreSQL 14+ with uuid-ossp extension (from 001_initial.sql).
-- Idempotency:   Safe to re-run. Uses CREATE TABLE IF NOT EXISTS.
-- =============================================================================

-- =============================================================================
-- TABLE: code_files
-- =============================================================================
-- Indexed source files tracked by the tree-sitter parser.
-- content_hash enables change detection without re-parsing unchanged files.
-- =============================================================================

CREATE TABLE IF NOT EXISTS code_files (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_path       TEXT NOT NULL UNIQUE,
  language        TEXT NOT NULL,             -- 'typescript', 'javascript', 'python', 'sql'
  content_hash    TEXT NOT NULL,             -- SHA-256 for change detection
  line_count      INTEGER NOT NULL DEFAULT 0,
  last_indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- TABLE: code_symbols
-- =============================================================================
-- Symbols extracted from AST: functions, classes, methods, interfaces, etc.
-- qualified_name provides the fully-qualified path (e.g., 'MyClass.myMethod').
-- =============================================================================

CREATE TABLE IF NOT EXISTS code_symbols (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id         UUID NOT NULL REFERENCES code_files(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  qualified_name  TEXT NOT NULL,             -- e.g., 'MyClass.myMethod'
  kind            TEXT NOT NULL,             -- 'function', 'class', 'method', 'interface', 'variable', 'type'
  start_line      INTEGER NOT NULL,
  end_line        INTEGER NOT NULL,
  signature       TEXT,                      -- function signature or class declaration
  exported        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- TABLE: code_imports
-- =============================================================================
-- Import relationships between files. target_file_id is NULL for external
-- (node_modules) imports that are not indexed in code_files.
-- =============================================================================

CREATE TABLE IF NOT EXISTS code_imports (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_file_id    UUID NOT NULL REFERENCES code_files(id) ON DELETE CASCADE,
  target_path       TEXT NOT NULL,           -- resolved import path
  target_file_id    UUID REFERENCES code_files(id) ON DELETE SET NULL,
  import_names      TEXT[] NOT NULL DEFAULT '{}',
  is_default_import BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- TABLE: code_edges
-- =============================================================================
-- Call graph and usage edges between symbols. The UNIQUE constraint prevents
-- duplicate edges of the same type between two symbols.
-- =============================================================================

CREATE TABLE IF NOT EXISTS code_edges (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_symbol_id  UUID NOT NULL REFERENCES code_symbols(id) ON DELETE CASCADE,
  target_symbol_id  UUID NOT NULL REFERENCES code_symbols(id) ON DELETE CASCADE,
  edge_type         TEXT NOT NULL,           -- 'calls', 'references', 'extends', 'implements', 'imports'
  weight            INTEGER NOT NULL DEFAULT 1,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source_symbol_id, target_symbol_id, edge_type)
);

-- =============================================================================
-- INDEXES — optimized for graph traversal queries
-- =============================================================================

-- code_files: lookup by path (covered by UNIQUE), filter by language
CREATE INDEX IF NOT EXISTS idx_code_files_language
  ON code_files (language);

-- code_symbols: find symbols in a file, by name, by kind, by qualified name
CREATE INDEX IF NOT EXISTS idx_code_symbols_file_id
  ON code_symbols (file_id);
CREATE INDEX IF NOT EXISTS idx_code_symbols_name
  ON code_symbols (name);
CREATE INDEX IF NOT EXISTS idx_code_symbols_kind
  ON code_symbols (kind);
CREATE INDEX IF NOT EXISTS idx_code_symbols_qualified_name
  ON code_symbols (qualified_name);

-- code_imports: traverse import graph in both directions
CREATE INDEX IF NOT EXISTS idx_code_imports_source_file_id
  ON code_imports (source_file_id);
CREATE INDEX IF NOT EXISTS idx_code_imports_target_file_id
  ON code_imports (target_file_id);

-- code_edges: traverse call graph in both directions, filter by type
CREATE INDEX IF NOT EXISTS idx_code_edges_source_symbol_id
  ON code_edges (source_symbol_id);
CREATE INDEX IF NOT EXISTS idx_code_edges_target_symbol_id
  ON code_edges (target_symbol_id);
CREATE INDEX IF NOT EXISTS idx_code_edges_edge_type
  ON code_edges (edge_type);

-- =============================================================================
-- BLAST RADIUS — sample recursive CTE
-- =============================================================================
-- Given a changed file, compute the transitive closure of affected symbols.
--
-- Usage: replace 'path/to/changed/file.ts' with the actual file path.
--
-- WITH RECURSIVE blast_radius AS (
--   -- Base case: all symbols defined in the changed file
--   SELECT
--     cs.id            AS symbol_id,
--     cs.qualified_name,
--     cs.kind,
--     cf.file_path,
--     0                AS depth
--   FROM code_symbols cs
--   JOIN code_files cf ON cf.id = cs.file_id
--   WHERE cf.file_path = 'path/to/changed/file.ts'
--
--   UNION
--
--   -- Recursive step: follow edges to symbols that reference/call the changed symbols
--   SELECT
--     cs2.id           AS symbol_id,
--     cs2.qualified_name,
--     cs2.kind,
--     cf2.file_path,
--     br.depth + 1     AS depth
--   FROM blast_radius br
--   JOIN code_edges ce  ON ce.target_symbol_id = br.symbol_id
--   JOIN code_symbols cs2 ON cs2.id = ce.source_symbol_id
--   JOIN code_files cf2   ON cf2.id = cs2.file_id
--   WHERE br.depth < 5  -- limit traversal depth to prevent runaway queries
-- )
-- SELECT DISTINCT
--   symbol_id,
--   qualified_name,
--   kind,
--   file_path,
--   MIN(depth) AS min_depth
-- FROM blast_radius
-- GROUP BY symbol_id, qualified_name, kind, file_path
-- ORDER BY min_depth, file_path, qualified_name;
-- =============================================================================

-- =============================================================================
-- STORED FUNCTION: blast_radius
-- =============================================================================
-- Given a changed file, compute the transitive closure of all affected symbols
-- and files via recursive CTE traversal of code_edges.
--
-- Parameters:
--   p_file_path  — path of the changed file
--   p_max_depth  — maximum traversal depth (default 5, prevents runaway queries)
--
-- Returns JSONB:
--   { file_path, max_depth, affected_files[], affected_symbols[], total_affected }
--
-- Cycle safety: UNION (not UNION ALL) deduplicates rows so a symbol that has
-- already been visited at a shallower depth is not re-expanded.
-- Missing file: returns zero affected symbols/files gracefully.
-- =============================================================================

CREATE OR REPLACE FUNCTION blast_radius(
  p_file_path  TEXT,
  p_max_depth  INTEGER DEFAULT 5
) RETURNS JSONB AS $$
  WITH RECURSIVE affected AS (
    -- Base case: all symbols defined in the changed file
    SELECT
      cs.id,
      cs.name,
      cs.qualified_name,
      cs.kind,
      cf.file_path,
      0 AS depth
    FROM code_symbols cs
    JOIN code_files cf ON cs.file_id = cf.id
    WHERE cf.file_path = p_file_path

    UNION

    -- Recursive step: symbols whose edges point TO an already-affected symbol
    SELECT
      cs2.id,
      cs2.name,
      cs2.qualified_name,
      cs2.kind,
      cf2.file_path,
      a.depth + 1
    FROM affected a
    JOIN code_edges ce  ON ce.target_symbol_id = a.id
    JOIN code_symbols cs2 ON ce.source_symbol_id = cs2.id
    JOIN code_files cf2   ON cs2.file_id = cf2.id
    WHERE a.depth < p_max_depth
  )
  SELECT jsonb_build_object(
    'file_path',        p_file_path,
    'max_depth',        p_max_depth,
    'affected_files',   COALESCE(
      (SELECT jsonb_agg(DISTINCT sub.file_path) FROM affected sub), '[]'::JSONB
    ),
    'affected_symbols', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'name',           sub.name,
        'qualified_name', sub.qualified_name,
        'kind',           sub.kind,
        'file_path',      sub.file_path,
        'depth',          sub.depth
      )) FROM affected sub), '[]'::JSONB
    ),
    'total_affected',   (SELECT COUNT(DISTINCT sub.id) FROM affected sub)
  );
$$ LANGUAGE SQL STABLE;

-- =============================================================================
-- STORED FUNCTION: search_symbols
-- =============================================================================
-- Filtered symbol lookup across the code graph.
--
-- Parameters:
--   p_name_pattern — ILIKE pattern for symbol name (e.g., '%Handler%')
--   p_kind         — optional exact symbol kind filter ('function', 'class', …)
--   p_file_path    — optional exact file path filter
--
-- Returns JSONB:
--   { pattern, kind, file_path, symbols[], total }
--
-- All filters are optional (NULL = no filter).  Results ordered by file then name.
-- =============================================================================

CREATE OR REPLACE FUNCTION search_symbols(
  p_name_pattern TEXT,
  p_kind         TEXT DEFAULT NULL,
  p_file_path    TEXT DEFAULT NULL
) RETURNS JSONB AS $$
  SELECT jsonb_build_object(
    'pattern',   p_name_pattern,
    'kind',      p_kind,
    'file_path', p_file_path,
    'symbols',   COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'id',             cs.id,
        'name',           cs.name,
        'qualified_name', cs.qualified_name,
        'kind',           cs.kind,
        'file_path',      cf.file_path,
        'start_line',     cs.start_line,
        'end_line',       cs.end_line,
        'signature',      cs.signature,
        'exported',       cs.exported
      ) ORDER BY cf.file_path, cs.name)
      FROM code_symbols cs
      JOIN code_files cf ON cs.file_id = cf.id
      WHERE cs.name ILIKE p_name_pattern
        AND (p_kind      IS NULL OR cs.kind     = p_kind)
        AND (p_file_path IS NULL OR cf.file_path = p_file_path)
      ), '[]'::JSONB
    ),
    'total', (
      SELECT COUNT(*)
      FROM code_symbols cs
      JOIN code_files cf ON cs.file_id = cf.id
      WHERE cs.name ILIKE p_name_pattern
        AND (p_kind      IS NULL OR cs.kind     = p_kind)
        AND (p_file_path IS NULL OR cf.file_path = p_file_path)
    )
  );
$$ LANGUAGE SQL STABLE;

-- =============================================================================
-- STORED FUNCTION: get_import_chain
-- =============================================================================
-- Compute the transitive import dependency chain for a file.
-- Follows code_imports edges recursively to find all directly and indirectly
-- imported files.
--
-- Parameters:
--   p_file_path — starting file path
--
-- Returns JSONB:
--   { file_path, imports[], total }
--
-- Cycle safety: UNION deduplicates so circular imports terminate naturally.
-- Missing / external imports (target_file_id IS NULL) are excluded from the
-- recursive traversal but included as leaf entries.
-- =============================================================================

CREATE OR REPLACE FUNCTION get_import_chain(
  p_file_path TEXT
) RETURNS JSONB AS $$
  WITH RECURSIVE chain AS (
    -- Base case: direct imports of the starting file
    SELECT
      ci.target_file_id,
      ci.target_path,
      cf_target.file_path AS resolved_path,
      cf_target.language,
      0 AS depth
    FROM code_imports ci
    JOIN code_files cf_source ON ci.source_file_id = cf_source.id
    LEFT JOIN code_files cf_target ON ci.target_file_id = cf_target.id
    WHERE cf_source.file_path = p_file_path

    UNION

    -- Recursive step: imports of already-discovered internal files
    SELECT
      ci2.target_file_id,
      ci2.target_path,
      cf_t2.file_path AS resolved_path,
      cf_t2.language,
      c.depth + 1
    FROM chain c
    JOIN code_imports ci2   ON ci2.source_file_id = c.target_file_id
    LEFT JOIN code_files cf_t2 ON ci2.target_file_id = cf_t2.id
    WHERE c.target_file_id IS NOT NULL   -- only follow internal imports
      AND c.depth < 20                   -- safety cap
  )
  SELECT jsonb_build_object(
    'file_path', p_file_path,
    'imports',   COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'target_path',   sub.target_path,
        'resolved_path', sub.resolved_path,
        'language',      sub.language,
        'depth',         sub.depth,
        'is_external',   (sub.target_file_id IS NULL)
      ) ORDER BY sub.depth, sub.target_path)
      FROM chain sub), '[]'::JSONB
    ),
    'total', (SELECT COUNT(*) FROM chain sub)
  );
$$ LANGUAGE SQL STABLE;

-- ── Migration audit marker ───────────────────────────────────────────────────
INSERT INTO system_config (key, value, description)
VALUES (
  'migration_003_code_graph',
  '"applied"'::JSONB,
  'Set by 003-code-graph.sql — code graph engine schema + stored functions for blast radius computation'
)
ON CONFLICT (key) DO UPDATE SET value = '"applied"'::JSONB, updated_at = NOW();
