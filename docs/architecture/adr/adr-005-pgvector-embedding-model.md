---
title: "ADR-005: pgvector Embedding Model Selection"
ticket: CTO-intelligence-architecture
type: architecture
author: Architect
date: 2026-03-12T00:00:00Z
status: PROPOSED
tags: [architecture, adr, pgvector, embeddings, memory, phase3]
---

# ADR-005: pgvector Embedding Model Selection

> **Ticket:** CTO-intelligence-architecture | **Agent:** Architect | **Date:** 2026-03-12  
> **Confidence:** HIGH (88%) | **Status:** PROPOSED

---

## 1. Status

**PROPOSED** — 2026-03-12

---

## 2. Context

ForgeOS Phase 3 (Memory Engine) stores distilled lessons from ticket rejection→fix cycles as vector embeddings. The system needs:

1. An embedding model to convert lesson text into vectors
2. A vector storage + index strategy in PostgreSQL
3. A similarity search mechanism for prompt injection

**Constraints:**
- Must integrate with existing PostgreSQL 14+ stack
- Lesson texts are short (50–500 tokens typically)
- Search corpus will grow to ~10K–100K lessons per project
- Query latency must be < 10ms for top-5 results
- Must support multi-tenancy via `project_id` filtering

---

## 3. Alternatives Evaluated

### 3.1 Embedding Models

| Model | Provider | Dimensions | Cost | Quality (MTEB) | Latency |
|-------|----------|-----------|------|----------------|---------|
| text-embedding-3-small | OpenAI | 1536 | $0.02/1M tokens | 62.3 | ~100ms |
| text-embedding-3-large | OpenAI | 3072 | $0.13/1M tokens | 64.6 | ~150ms |
| all-MiniLM-L6-v2 | Sentence-Transformers | 384 | Free (local) | 56.3 | ~10ms |
| nomic-embed-text-v1.5 | Nomic | 768 | Free (local) | 61.7 | ~20ms |
| voyage-code-3 | Voyage AI | 1024 | $0.06/1M tokens | 66.5 (code) | ~120ms |

### 3.2 Vector Storage

| Solution | Integration | Index Types | Filtering | Operational Overhead |
|----------|------------|-------------|-----------|---------------------|
| pgvector (in-process) | Native extension | IVFFlat, HNSW | SQL WHERE clauses | Zero — same PostgreSQL |
| Qdrant (external) | gRPC/HTTP | HNSW | Rich filtering | New service to operate |
| Pinecone (managed) | HTTP | Proprietary | Metadata filters | Vendor lock-in |
| ChromaDB (embedded) | Python SDK | HNSW | Metadata | Python-only; separate process |

---

## 4. Decision

### Embedding Model: OpenAI `text-embedding-3-small` (1536 dimensions)

**Rationale:**
1. Best quality-to-cost ratio for short texts
2. 1536 dimensions is the sweet spot — 3072 gives only marginal quality gains for 6.5x cost
3. ForgeOS already operates in an AI-heavy environment (agents call LLMs); one more API is not a new dependency
4. Configurable: `system_config.embedding_model` allows switching to local model for air-gapped deployments

**Fallback:** `all-MiniLM-L6-v2` (384 dimensions) for offline/local deployments. Requires a second `lesson_embeddings` row with `model = 'all-MiniLM-L6-v2'` and a separate index.

### Vector Storage: pgvector (in-process PostgreSQL extension)

**Rationale:**
1. **Zero operational overhead** — no new service to deploy, monitor, or back up
2. **Native SQL filtering** — `WHERE project_id = $1 AND agent_role = $2` combined with vector search in a single query
3. **Transactional consistency** — lesson creation + embedding insertion in one transaction
4. **Existing infrastructure** — ForgeOS already runs PostgreSQL 14+ with backups, monitoring, and migrations

### Index Type: HNSW over IVFFlat

**Rationale:**
1. HNSW provides 99% recall vs 95% for IVFFlat at comparable latency
2. No upfront cluster count selection needed (IVFFlat requires specifying `lists`)
3. Better for incremental inserts — IVFFlat degrades without periodic re-training
4. Target corpus size (100K) is well within HNSW's efficient range

**Parameters:**
- `m = 16`: bi-directional links per node (default; good for 100K vectors)
- `ef_construction = 200`: higher build accuracy (insert-time tradeoff is acceptable for batch indexing)
- `ef_search = 100` (runtime parameter via `SET hnsw.ef_search = 100`)

---

## 5. Consequences

### Positive
- Single PostgreSQL instance stores tickets, code graph, AND memory vectors
- Familiar SQL interface for all queries
- Backup/restore covers everything atomically
- Sub-10ms search at 100K vectors with HNSW

### Negative
- External API dependency for embeddings (OpenAI) — mitigated by local fallback
- pgvector HNSW index consumes ~2x storage vs IVFFlat — acceptable for 100K vectors (~300MB)
- Embedding model upgrades require re-embedding existing lessons

### Risks
- OpenAI API rate limiting during bulk embedding (mitigated: batch with exponential backoff)
- pgvector version compatibility with PostgreSQL upgrades (mitigated: pin pgvector version in Docker image)

---

## 6. Configuration

```sql
INSERT INTO system_config (key, value, description) VALUES
    ('embedding_model', '"text-embedding-3-small"', 'Model used for lesson embeddings'),
    ('embedding_dimensions', '1536', 'Vector dimension count'),
    ('embedding_api_url', '"https://api.openai.com/v1/embeddings"', 'Embedding API endpoint'),
    ('similarity_threshold', '0.75', 'Minimum cosine similarity for lesson injection'),
    ('max_injected_lessons', '5', 'Maximum lessons injected per dispatch');
```
