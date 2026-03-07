# Changelog

All notable changes to ForgeOS Server are documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **Docker Compose stack** — Production-ready `docker-compose.yml` with three
  services: `postgres` (PostgreSQL 17 Alpine with healthcheck, persistent
  volume, auto-applied migrations), `pgbouncer` (transaction mode, 50 pool
  size, 200 max connections), and `mcp-server` (built from Dockerfile,
  connects through PgBouncer). Uses Docker file-based secrets for the
  database password. All services restart automatically
  (`forgeos-server/docker-compose.yml`, `forgeos-server/secrets/.gitkeep`).
- **Husky commit-msg hook** — Validates that every commit message starts
  with a ticket ID in `[TICKET-ID]` format
  (`forgeos-server/.husky/commit-msg`,
  `forgeos-server/scripts/validate-commit.sh`). Rejects non-matching
  messages with a clear error showing valid CLAIM and WORK commit
  formats. Bypass with `git commit --no-verify` for emergencies.
- **Dockerfile** — Multi-stage Docker build for the ForgeOS MCP server
  (`forgeos-server/Dockerfile`). Builder stage compiles TypeScript with
  `npm ci`; runtime stage runs as non-root `node` user on Alpine with a
  built-in `HEALTHCHECK` on `/health`. Image expected under 200 MB.
- **.dockerignore** — Build-context exclusion rules that prevent
  `node_modules`, `.git`, `dist`, secrets, and env files from entering the
  image while allowing `README.md` and `.env.example` through.
- **Environment configuration** — Zod-validated config loader (`src/config.ts`)
  with typed `AppConfig` export, `Object.freeze()` immutability, sensible
  defaults (PORT=3000, LOG_LEVEL=info, DEFAULT_LEASE_MINUTES=30), production
  validation for security-critical variables (`WEBHOOK_SECRET`, `ADMIN_API_KEY`),
  and a comprehensive `.env.example` template documenting all 12 environment
  variables.
- **Database schema** — Initial PostgreSQL migration (`001_initial.sql`) with
  7 tables (projects, agents, sessions, tickets, file_locks, events,
  system_config), 5 enum types, 18+ indexes (B-tree, GIN, partial), Row-Level
  Security policies, 10 stored functions (claim, advance, reject, release,
  extend lease, resolve dependencies, release expired claims, notify), and
  triggers for auto-updated timestamps and real-time SSE via `pg_notify`.
- **Database connection pool** (`src/db/pool.ts`) — Lazily-initialized
  `pg.Pool` singleton with configurable max connections (20), idle timeout
  (30 s), and connection timeout (10 s). Includes `healthCheck()` for
  connectivity verification, `setSessionContext()` for PostgreSQL RLS
  session variables, `queryWithRLS()` and `transactionWithRLS()` helpers
  with automatic rollback and slow-query logging (> 1 s threshold).
  Structured pino log events for connection errors, pool exhaustion, and
  client lifecycle.
- **Migration runner** (`src/db/migrate.ts`) — Tracks applied migrations in a
  `schema_migrations` table with SHA-256 checksum verification. Reads `.sql`
  files in lexicographic order, skips already-applied migrations (idempotent),
  and rolls back on failure. Runnable via `npm run migrate` or CLI.
- **Database barrel exports** (`src/db/index.ts`) — Re-exports pool, health
  check, RLS helpers, and migration runner from the `db` module.
- **Schema reference documentation** (`docs/database/schema-reference.md`) —
  Complete reference for all database objects, indexes, functions, and
  relationships.
