# TASK-INT-DO002 — Install and Configure pgvector Extension

## Stage: BACKEND (infra) — DevOps Engineer

## Summary

Installed pgvector 0.7+ in the PostgreSQL Docker image by switching the base
image from `postgres:17-alpine` to `pgvector/pgvector:pg17` (ships pgvector
0.8.0 pre-installed). Updated all docker-compose files, init scripts, health
checks, and created the migration for embedding tables with HNSW indexing.

## Changes

| File | Action | Description |
|------|--------|-------------|
| `infra/docker/postgres/Dockerfile` | UPDATED | Base image → `pgvector/pgvector:pg17`, labels updated |
| `infra/docker/postgres/init.sql` | UPDATED | Added `CREATE EXTENSION IF NOT EXISTS "vector"`, verification updated to expect 3 extensions |
| `infra/docker-compose.yml` | UPDATED | postgres service now builds from `./docker/postgres/Dockerfile` instead of pulling `postgres:17-alpine` |
| `forgeos-server/docker-compose.yml` | UPDATED | postgres service builds from `../infra/docker/postgres/Dockerfile` |
| `infra/docker/healthchecks/check-postgres.sh` | UPDATED | Extension check includes `vector`, threshold raised to 3 |
| `forgeos-server/src/db/migrations/004-pgvector.sql` | NEW | Enables vector extension, creates `code_embeddings` table with HNSW index |

## Acceptance Criteria Verification

| # | Criterion | Status |
|---|-----------|--------|
| 1 | PostgreSQL Docker image includes pgvector 0.7+ | ✅ `pgvector/pgvector:pg17` ships 0.8.0 |
| 2 | `infra/docker/Dockerfile.postgres` created/updated | ✅ Updated `infra/docker/postgres/Dockerfile` (existing location) |
| 3 | All docker-compose files reference pgvector-enabled image | ✅ Both `infra/docker-compose.yml` and `forgeos-server/docker-compose.yml` updated |
| 4 | `CREATE EXTENSION IF NOT EXISTS vector` in DB init | ✅ Added to `init.sql` and migration `004-pgvector.sql` |
| 5 | HNSW index params documented (m=16, ef_construction=200) | ✅ Documented in migration SQL comments and index DDL |
| 6 | Migration SQL for vector extension and embedding tables | ✅ `004-pgvector.sql` — extension, table, HNSW index, supporting indexes |
| 7 | Verification test: vector extension exists | ✅ `init.sql` verification block checks for vector; migration has `DO $$` verification; health check validates extension |

## HNSW Index Configuration

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| `m` | 16 | Balanced recall/memory for < 1M vectors |
| `ef_construction` | 200 | Higher than default (64) for better build-time recall |
| Operator class | `vector_cosine_ops` | Cosine distance — standard for text embeddings |
| Dimension | 1536 | OpenAI `text-embedding-3-small` default |

## Decisions

- Used `pgvector/pgvector:pg17` official image instead of building from source — simpler, maintained upstream, ships 0.8.0
- Switched from Alpine to Debian-based PG17 (pgvector official images are Debian-based) — pgvector requires build tools not available on Alpine without extra packages
- Added `CHECK` constraint on `code_embeddings` to ensure at least one of `symbol_id` or `file_id` is set
- Created partial indexes on `symbol_id` and `file_id` for efficient filtered lookups

## Confidence: HIGH

All changes are declarative, idempotent, and follow existing conventions.

## Timestamp: 2026-03-12T23:00:00Z
