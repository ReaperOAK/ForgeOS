# Changelog

All notable changes to ForgeOS Server are documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

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
- **Migration runner** (`src/db/migrate.ts`) — Tracks applied migrations in a
  `_migrations` table, executes pending `.sql` files in transactions.
- **Schema reference documentation** (`docs/database/schema-reference.md`) —
  Complete reference for all database objects, indexes, functions, and
  relationships.
