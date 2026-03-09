# FORGEOS-DO006 — BACKEND Stage Summary

## Ticket
- **ID:** FORGEOS-DO006
- **Title:** Create Database Migration CI Step
- **Type:** infra
- **Stage:** BACKEND (complete)

## Artifacts

| File | Action |
|------|--------|
| `.github/workflows/database-ci.yml` | Created |

## Implementation Details

### GitHub Actions Workflow: `database-ci.yml`

Created a dedicated Database Migration CI workflow that validates Alembic migrations
against a clean PostgreSQL 17-alpine instance (same version as production per
`infra/docker-compose.yml`).

**Workflow triggers:** Push/PR to `main` when migration-related files change
(`mcp-server/alembic/**`, `mcp-server/alembic.ini`, `mcp-server/pyproject.toml`,
`.github/workflows/database-ci.yml`).

### Pipeline steps:

1. **Apply all migrations from scratch** — Runs `alembic upgrade head` against a clean
   PostgreSQL 17 service container. Reports available migrations, apply duration, and
   head revision. Fails if any migration produces errors.

2. **Schema validation** — Validates all expected database objects exist:
   - 7 tables: `projects`, `agents`, `sessions`, `tickets`, `file_locks`, `events`, `system_config`
   - 5 enum types: `ticket_status`, `ticket_stage`, `ticket_type`, `ticket_priority`, `event_type`
   - 20 indexes including partial/GIN indexes for query-path optimization
   - 3 triggers (`trg_*_updated_at`)
   - 1 function (`update_updated_at`)
   - `uuid-ossp` extension

3. **Rollback and reapply** — Downgrades the most recent migration (to `base` if only
   one migration exists, or `-1` for multiple), then reapplies `upgrade head` to verify
   reversibility and idempotency.

4. **Migration report** — Generates a step summary with PostgreSQL version, database name,
   migration tool, apply duration, head revision, and all migration files processed.

### Acceptance Criteria Mapping

| # | Criterion | Status |
|---|-----------|--------|
| 1 | CI applies all migrations to a clean PostgreSQL database from scratch | ✅ Step 1 |
| 2 | Schema validation step checks that all expected tables and indexes exist | ✅ Step 2 |
| 3 | Most recent migration is rolled back and reapplied to test reversibility | ✅ Step 3 |
| 4 | CI fails if any migration produces errors during apply or rollback | ✅ All steps fail on non-zero exit |
| 5 | Migration CI uses the same PostgreSQL version as production configuration | ✅ postgres:17-alpine |
| 6 | Workflow reports which migrations were applied and their execution time | ✅ Step 1 + Step 4 |

## Test Results

- **Infrastructure tests:** Workflow YAML is valid GitHub Actions syntax; verified against
  existing `mcp-server-ci.yml` patterns (same service container config, same Python/pip setup).
- **Local validation:** N/A — GitHub Actions workflows execute only in CI. Schema validation
  queries verified against the initial migration's exact DDL statements.

## SLO/SLI Targets

- **CI execution time:** Target < 10 minutes (timeout-minutes: 10)
- **Migration idempotency:** Rollback + reapply must succeed without errors

## Security

- No secrets hardcoded — uses ephemeral CI-only `POSTGRES_PASSWORD`
- `permissions: contents: read` — minimal GitHub token permissions
- No images pushed; no deployment

## Confidence

**HIGH** — Workflow directly maps each acceptance criterion to a discrete step.
Schema validation covers all 7 tables, 5 enums, 20 indexes, 3 triggers, and 1 function
from the initial migration. PostgreSQL version matches production exactly.
