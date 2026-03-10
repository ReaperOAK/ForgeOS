# Database Migration CI Pipeline

<!-- last_reviewed: 2026-03-10T14:30:00Z -->
<!-- diataxis: reference -->

> Reference document for the Database Migration CI workflow
> (`.github/workflows/database-ci.yml`). Describes triggers, pipeline steps,
> schema validation inventory, and troubleshooting guidance.

## Overview

The Database Migration CI pipeline validates Alembic migrations against a
clean PostgreSQL 17-alpine instance on every push or pull request that
modifies migration-related files. It runs four stages:

1. Apply all migrations from scratch.
2. Validate the resulting schema (tables, indexes, enums, triggers).
3. Roll back the most recent migration and reapply it.
4. Generate a summary report with timing data.

The pipeline fails on any migration apply, schema validation, or rollback
error. It produces a GitHub Actions step summary with detailed results.

## Trigger Conditions

The workflow fires on `push` and `pull_request` to `main` when any of
these paths change:

| Path | What it covers |
|------|----------------|
| `mcp-server/alembic/**` | Migration scripts (`versions/`, `env.py`) |
| `mcp-server/alembic.ini` | Alembic configuration |
| `mcp-server/pyproject.toml` | Python dependencies (may affect alembic) |
| `.github/workflows/database-ci.yml` | The workflow itself |

## Pipeline Steps

### Step 1 — Apply All Migrations

Runs `alembic upgrade head` on a clean database. Measures apply duration in
milliseconds. Exports two output variables:

| Variable | Description |
|----------|-------------|
| `apply_duration_ms` | Wall-clock time for the upgrade command |
| `head_revision` | Alembic revision ID at head after apply |

Fails with `::error::` annotation if the apply exits non-zero.

### Step 2 — Validate Database Schema

Queries `pg_catalog` and `information_schema` to verify every expected
database object exists.

| Category | Expected objects | Count |
|----------|-----------------|-------|
| Tables | `projects`, `agents`, `sessions`, `tickets`, `file_locks`, `events`, `system_config` | 7 |
| Enums | `ticket_status`, `ticket_stage`, `ticket_type`, `ticket_priority`, `event_type` | 5 |
| Indexes | 20 query-path indexes (see workflow for full list) | 20 |
| Triggers | `trg_projects_updated_at`, `trg_agents_updated_at`, `trg_tickets_updated_at` | 3 |
| Functions | `update_updated_at` | 1 |
| Extensions | `uuid-ossp` (warning only if missing) | 1 |

Fails with `::error::` if any table, enum, index, trigger, or function is
missing.

### Step 3 — Rollback and Reapply

Tests migration reversibility:

1. Identifies the downgrade target (`-1` for multi-migration stacks,
   `base` for single-migration stacks).
2. Runs `alembic downgrade <target>`.
3. Runs `alembic upgrade head` to reapply.

Both commands must exit zero. This confirms migrations can be safely
rolled back in production if needed.

### Step 4 — Summary Report

Runs unconditionally (`if: always()`) so a report is produced even when
earlier steps fail. Outputs a Markdown summary table with:

- PostgreSQL version and database name.
- Migration tool and apply duration.
- Head revision ID.
- List of migration files processed.

## Service Container

| Setting | Value |
|---------|-------|
| Image | `postgres:17-alpine` |
| Database | `forgeos_migration_test` |
| User | `forgeos` |
| Password | `forgeos_migration_ci` (ephemeral, CI-only) |
| Port | `5432` |
| Health check | `pg_isready` with 5 retries, 10 s interval, 15 s start period |

Credentials are CI-only and never shared with production environments.

## Error Handling Patterns

| Pattern | Where used | Purpose |
|---------|-----------|---------|
| `PIPESTATUS[0]` after `tee` | Steps 1, 3 | Captures exit code of `alembic` despite pipe to `tee` |
| `exit 1` on failure | Steps 1, 2, 3 | Fails the step immediately |
| `::error::` annotations | Steps 1, 2, 3 | Surfaces errors in the GitHub Actions UI |
| `if: always()` | Step 4 | Generates report even on prior failure |
| `|| true` after `alembic current` | Steps 1, 3 | Prevents failure on empty database state |

## Permissions

The workflow requests `contents: read` only. No write access is needed
because the pipeline only validates — it never mutates the repository.

## Concurrency

One run per branch. In-progress runs are cancelled when a new commit is
pushed to the same branch (`cancel-in-progress: true`), saving CI minutes
during rapid iteration.

## How To: Add a New Migration

1. Create the migration: `cd mcp-server && alembic revision --autogenerate -m "description"`.
2. Edit the generated file in `mcp-server/alembic/versions/`.
3. If the migration adds tables, enums, indexes, triggers, or functions,
   update the expected-objects lists in Step 2 of the workflow.
4. Push or open a PR — the CI pipeline validates automatically.

## Troubleshooting

| Symptom | Likely cause | Resolution |
|---------|-------------|------------|
| Step 1 fails with "Target database is not up to date" | `alembic.ini` points to wrong database | Verify `DATABASE_URL` matches the service container |
| Step 2 reports missing table | Migration does not create the expected table | Update the migration or the expected-tables list |
| Step 3 rollback fails | Migration `downgrade()` is not implemented | Add a `downgrade()` function to the migration |
| Step 4 shows empty apply duration | Step 1 failed before recording output | Fix Step 1 errors first |

## Related Documents

- [Backup Strategy](backup-strategy.md) — production backup and restore procedures.
- [Database Schema Reference](../database/schema-reference.md) — full schema documentation.
- [Database Indexes](../architecture/database-indexes.md) — index design rationale.
